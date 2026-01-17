import os
import json
import re
from typing import Dict, Any, AsyncIterator, List, TypedDict
from datetime import datetime, timedelta
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage, SystemMessage

# Try to import Tavily and Composio (for Reddit MCP)
try:
    from tavily import TavilyClient
    TAVILY_AVAILABLE = True
except ImportError:
    TAVILY_AVAILABLE = False
    print("Warning: tavily-python not installed. Tavily search will be simulated.")

try:
    from composio import Composio
    import httpx
    COMPOSIO_AVAILABLE = True
except ImportError:
    COMPOSIO_AVAILABLE = False
    print("Warning: composio not installed. Reddit search will be simulated.")

# Store for pending approvals (in production, use Redis or similar)
pending_approvals: Dict[str, Dict[str, Any]] = {}

# Store for agent state
agent_states: Dict[str, Dict[str, Any]] = {}


class AgentState(TypedDict):
    query: str
    platforms: List[str]
    research: str
    sources: List[str]
    trending_topics: List[Dict[str, str]]
    needs_approval: bool
    approved: bool
    ideas: Dict[str, List[str]]  # platform -> list of ideas
    current_step: str
    session_id: str
    # New fields for three-step workflow
    scope: Dict[str, str]  # time_window, region, domain
    tools_to_use: List[str]  # ["tavily", "reddit"]
    trend_candidates: List[Dict[str, Any]]  # Raw trend data with source metadata
    enriched_trends: List[Dict[str, Any]]  # Trends with synthesis
    research_report: str  # Final formatted report
    confidence_scores: Dict[str, Dict[str, Any]]  # trend_id -> {confidence, rationale}


class MarketingCopyAgent:
    def __init__(self):
        self.llm = ChatOpenAI(
            model="gpt-4-turbo-preview",
            temperature=0.7,
            streaming=True
        )
        
        # Load trend sources config
        self.trend_sources_config = self._load_trend_sources_config()
        
        # Initialize Tavily client if available
        self.tavily_client = None
        if TAVILY_AVAILABLE:
            tavily_api_key = os.getenv("TAVILY_API_KEY")
            if tavily_api_key:
                self.tavily_client = TavilyClient(api_key=tavily_api_key)
        
        # Initialize Composio client for Reddit MCP if available
        self.composio_client = None
        self.composio_mcp_url = None
        self.composio_api_key = None
        if COMPOSIO_AVAILABLE:
            composio_api_key = os.getenv("COMPOSIO_API_KEY")
            composio_user_id = os.getenv("COMPOSIO_USER_ID")
            if composio_api_key and composio_user_id:
                try:
                    self.composio_client = Composio(api_key=composio_api_key)
                    self.composio_api_key = composio_api_key
                    # Create a session with Reddit toolkit
                    session = self.composio_client.create(
                        user_id=composio_user_id,
                        toolkits=["reddit"]
                    )
                    self.composio_mcp_url = session.mcp.url
                    print(f"Composio Reddit MCP session created: {self.composio_mcp_url}")
                except Exception as e:
                    print(f"Error initializing Composio client: {e}")
                    self.composio_client = None
        
        self.graph = self._build_graph()
    
    def _load_trend_sources_config(self) -> Dict[str, List[str]]:
        """Load trend sources configuration from JSON file"""
        config_path = os.path.join(os.path.dirname(__file__), "trend_sources_config.json")
        try:
            with open(config_path, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"Warning: trend_sources_config.json not found at {config_path}. Using empty config.")
            return {}
        except json.JSONDecodeError as e:
            print(f"Warning: Error parsing trend_sources_config.json: {e}. Using empty config.")
            return {}
    
    def _normalize_platform_name(self, platform: str) -> str:
        """Normalize platform name to match config keys (lowercase, handle aliases)"""
        platform_lower = platform.lower().strip()
        # Handle common aliases
        if platform_lower in ["x", "twitter"]:
            return "x"
        elif platform_lower == "linkedin":
            return "linkedin"
        elif platform_lower == "instagram":
            return "instagram"
        elif platform_lower == "tiktok":
            return "tiktok"
        elif platform_lower == "pinterest":
            return "pinterest"
        elif platform_lower == "facebook":
            return "facebook"
        elif platform_lower == "youtube":
            return "youtube"
        return platform_lower
    
    def _build_graph(self):
        """Build the LangGraph workflow with three-step research process"""
        workflow = StateGraph(AgentState)
        
        # Add nodes for the three-step workflow
        workflow.add_node("research_plan", self._research_plan_node)
        workflow.add_node("trend_retrieval", self._trend_retrieval_node)
        workflow.add_node("synthesize_report", self._research_report_node)
        workflow.add_node("wait_approval", self._wait_approval_node)
        workflow.add_node("generate_step", self._generate_ideas_node)
        
        # Set entry point
        workflow.set_entry_point("research_plan")
        
        # Add edges - sequential flow through research steps
        workflow.add_edge("research_plan", "trend_retrieval")
        workflow.add_edge("trend_retrieval", "synthesize_report")
        workflow.add_edge("synthesize_report", "wait_approval")
        
        # Conditional edge from wait_approval
        workflow.add_conditional_edges(
            "wait_approval",
            self._should_continue,
            {
                "approved": "generate_step",
                "needs_refinement": "research_plan",
                "waiting": END
            }
        )
        workflow.add_edge("generate_step", END)
        
        # Compile with memory
        memory = MemorySaver()
        return workflow.compile(checkpointer=memory)
    
    async def _research_plan_node(self, state: AgentState) -> AgentState:
        """Step 1: Research Plan - Clarify scope and decide which tools to use"""
        query = state["query"]
        
        # Use LLM to clarify scope automatically
        scope_prompt = f"""
        Analyze the following query and automatically determine the research scope:
        Query: {query}
        
        Determine:
        1. Time window: How recent should the trends be? (e.g., "last 7 days", "last 30 days", "last 3 months")
        2. Region: What geographic region is relevant? (e.g., "global", "US", "Europe", "Asia")
        3. Domain: What industry/domain is this about? (e.g., "technology", "marketing", "consumer goods", "finance")
        
        Return a JSON object with keys: time_window, region, domain
        """
        
        messages = [
            SystemMessage(content="You are a research planning assistant. Analyze queries and determine appropriate research scope."),
            HumanMessage(content=scope_prompt)
        ]
        
        response = await self.llm.ainvoke(messages)
        scope_text = response.content.strip()
        
        # Parse scope from response
        scope = {"time_window": "last 30 days", "region": "global", "domain": "general"}
        try:
            # Try to extract JSON from response
            json_match = re.search(r'\{.*?\}', scope_text, re.DOTALL)
            if json_match:
                scope = json.loads(json_match.group())
        except (json.JSONDecodeError, ValueError, AttributeError):
            # Fallback: try to infer from text
            if "week" in scope_text.lower() or "7 days" in scope_text.lower():
                scope["time_window"] = "last 7 days"
            elif "month" in scope_text.lower() or "30 days" in scope_text.lower():
                scope["time_window"] = "last 30 days"
            elif "quarter" in scope_text.lower() or "3 months" in scope_text.lower():
                scope["time_window"] = "last 3 months"
        
        # Decide which tools to use based on scope and availability
        tools_to_use = []
        if self.tavily_client:
            tools_to_use.append("tavily")
        elif TAVILY_AVAILABLE:
            # Tavily available but not configured - still add it
            tools_to_use.append("tavily")
        
        if self.composio_mcp_url:
            tools_to_use.append("reddit")
        elif COMPOSIO_AVAILABLE:
            # Composio available but not configured - still add it
            tools_to_use.append("reddit")
        
        # Default to both if available, or simulate if not
        if not tools_to_use:
            tools_to_use = ["tavily", "reddit"]  # Will be simulated
        
        return {
            **state,
            "scope": scope,
            "tools_to_use": tools_to_use,
            "current_step": "research_plan_complete"
        }
    
    async def _trend_retrieval_node(self, state: AgentState) -> AgentState:
        """Step 2: Trend Retrieval + Synthesis - Fetch trend candidates and enrich with sources"""
        query = state["query"]
        scope = state.get("scope", {})
        tools_to_use = state.get("tools_to_use", [])
        platforms = state.get("platforms", [])
        
        trend_candidates = []
        
        # Fetch from Tavily
        if "tavily" in tools_to_use:
            try:
                if self.tavily_client:
                    # Collect domains from all platforms
                    all_domains = []
                    for platform in platforms:
                        normalized_platform = self._normalize_platform_name(platform)
                        platform_domains = self.trend_sources_config.get(normalized_platform, [])
                        all_domains.extend(platform_domains)
                    
                    # Remove duplicates while preserving order
                    unique_domains = list(dict.fromkeys(all_domains))
                    
                    # Real Tavily search with platform-specific trend sources
                    search_query = f"{query} {scope.get('domain', '')} trends {scope.get('time_window', '')}"
                    
                    # Use platform-specific trend sources if available
                    if unique_domains:
                        # Try using include_domains parameter (Tavily API supports this)
                        # If that doesn't work, we'll fall back to site-specific queries
                        try:
                            search_params = {
                                "query": search_query,
                                "search_depth": "advanced",
                                "max_results": 10,
                                "include_domains": unique_domains
                            }
                            results = self.tavily_client.search(**search_params)
                            print(f"Tavily search with domains: {unique_domains[:5]}... (showing first 5)")
                        except (TypeError, AttributeError) as e:
                            # Fallback: construct site-specific queries if include_domains not supported
                            print(f"include_domains not supported, using site-specific queries: {e}")
                            all_results = {"results": []}
                            # Search each domain separately and combine results
                            for domain in unique_domains[:5]:  # Limit to first 5 domains to avoid too many API calls
                                try:
                                    site_query = f"site:{domain} {search_query}"
                                    domain_results = self.tavily_client.search(
                                        query=site_query,
                                        search_depth="advanced",
                                        max_results=3  # Fewer per domain to stay within limits
                                    )
                                    if domain_results.get("results"):
                                        all_results["results"].extend(domain_results["results"])
                                except Exception as domain_error:
                                    print(f"Error searching domain {domain}: {domain_error}")
                                    continue
                            results = all_results
                    else:
                        # No platform-specific domains, do general search
                        results = self.tavily_client.search(
                            query=search_query,
                            search_depth="advanced",
                            max_results=10
                        )
                    
                    for result in results.get("results", []):
                        trend_candidates.append({
                            "title": result.get("title", ""),
                            "content": result.get("content", ""),
                            "url": result.get("url", ""),
                            "published_date": result.get("published_date", ""),
                            "source": "tavily",
                            "raw_data": result
                        })
                else:
                    # Simulated Tavily results
                    trend_candidates.extend([
                        {
                            "title": f"Trending: {query} in {scope.get('domain', 'technology')}",
                            "content": f"Recent developments in {query} show significant growth and adoption.",
                            "url": "https://example.com/trend1",
                            "published_date": datetime.now().isoformat(),
                            "source": "tavily",
                            "raw_data": {}
                        },
                        {
                            "title": f"Industry Analysis: {query}",
                            "content": f"Market research indicates strong momentum for {query}.",
                            "url": "https://example.com/trend2",
                            "published_date": (datetime.now() - timedelta(days=2)).isoformat(),
                            "source": "tavily",
                            "raw_data": {}
                        }
                    ])
            except Exception as e:
                print(f"Error fetching from Tavily: {e}")
        
        # Fetch from Reddit via Composio MCP
        if "reddit" in tools_to_use:
            try:
                if self.composio_mcp_url and self.composio_api_key:
                    # Real Reddit search via Composio MCP
                    subreddits = ["technology", "marketing", "entrepreneur", "startups", "business"]
                    search_query = f"{query} {scope.get('domain', '')}"
                    
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        for subreddit_name in subreddits[:3]:  # Limit to 3 subreddits
                            try:
                                # Call MCP tool: search_reddit
                                mcp_request = {
                                    "jsonrpc": "2.0",
                                    "id": 1,
                                    "method": "tools/call",
                                    "params": {
                                        "name": "search_reddit",
                                        "arguments": {
                                            "query": search_query,
                                            "subreddit": subreddit_name,
                                            "sort": "hot",
                                            "limit": 5,
                                            "time_filter": "month"
                                        }
                                    }
                                }
                                
                                response = await client.post(
                                    self.composio_mcp_url,
                                    json=mcp_request,
                                    headers={
                                        "x-api-key": self.composio_api_key,
                                        "Content-Type": "application/json"
                                    }
                                )
                                
                                if response.status_code == 200:
                                    result = response.json()
                                    if "result" in result and "content" in result["result"]:
                                        # Parse the MCP response
                                        content = result["result"]["content"]
                                        # The content might be a list of posts or a structured response
                                        if isinstance(content, list):
                                            posts = content
                                        elif isinstance(content, dict) and "posts" in content:
                                            posts = content["posts"]
                                        else:
                                            # Try to extract posts from text response
                                            posts = []
                                            if isinstance(content, str):
                                                try:
                                                    content_dict = json.loads(content)
                                                    posts = content_dict.get("posts", [])
                                                except (json.JSONDecodeError, ValueError, TypeError):
                                                    pass
                                        
                                        for post in posts[:5]:  # Limit to 5 posts per subreddit
                                            trend_candidates.append({
                                                "title": post.get("title", ""),
                                                "content": post.get("selftext", post.get("body", ""))[:500],
                                                "url": post.get("url", f"https://reddit.com/r/{subreddit_name}"),
                                                "published_date": datetime.fromtimestamp(
                                                    post.get("created_utc", datetime.now().timestamp())
                                                ).isoformat(),
                                                "source": "reddit",
                                                "score": post.get("score", 0),
                                                "comments": post.get("num_comments", 0),
                                                "subreddit": subreddit_name,
                                                "raw_data": {
                                                    "id": post.get("id", ""),
                                                    "author": post.get("author", "unknown")
                                                }
                                            })
                            except Exception as e:
                                print(f"Error searching Reddit subreddit {subreddit_name} via MCP: {e}")
                else:
                    # Simulated Reddit results
                    trend_candidates.extend([
                        {
                            "title": f"Discussion: {query} is gaining traction",
                            "content": f"Community discussion about {query} shows increasing interest.",
                            "url": "https://reddit.com/r/technology/example",
                            "published_date": (datetime.now() - timedelta(days=1)).isoformat(),
                            "source": "reddit",
                            "score": 150,
                            "comments": 45,
                            "subreddit": "technology",
                            "raw_data": {}
                        }
                    ])
            except Exception as e:
                print(f"Error fetching from Reddit via Composio MCP: {e}")
        
        # Enrich trends with additional context using LLM
        enriched_trends = []
        for candidate in trend_candidates[:15]:  # Limit to top 15 for processing
            enrichment_prompt = f"""
            Analyze this trend candidate and provide:
            1. A 1-2 sentence summary
            2. Why this trend matters for marketing
            3. Key supporting evidence points
            
            Trend: {candidate.get('title', '')}
            Content: {candidate.get('content', '')[:500]}
            Source: {candidate.get('source', '')}
            
            Return JSON with: summary, why_it_matters, key_evidence
            """
            
            messages = [
                SystemMessage(content="You are a trend analysis expert. Provide concise, actionable insights."),
                HumanMessage(content=enrichment_prompt)
            ]
            
            try:
                response = await self.llm.ainvoke(messages)
                enrichment_text = response.content.strip()
                
                # Parse enrichment
                enrichment = {}
                try:
                    json_match = re.search(r'\{.*?\}', enrichment_text, re.DOTALL)
                    if json_match:
                        enrichment = json.loads(json_match.group())
                except (json.JSONDecodeError, ValueError, AttributeError):
                    enrichment = {
                        "summary": enrichment_text[:200],
                        "why_it_matters": "Relevant trend for target audience",
                        "key_evidence": [candidate.get("url", "")]
                    }
                
                enriched_trends.append({
                    **candidate,
                    "summary": enrichment.get("summary", candidate.get("title", "")),
                    "why_it_matters": enrichment.get("why_it_matters", "Relevant trend"),
                    "key_evidence": enrichment.get("key_evidence", [candidate.get("url", "")])
                })
            except Exception as e:
                print(f"Error enriching trend: {e}")
                # Add candidate without enrichment
                enriched_trends.append({
                    **candidate,
                    "summary": candidate.get("title", ""),
                    "why_it_matters": "Relevant trend for marketing",
                    "key_evidence": [candidate.get("url", "")]
                })
        
        return {
            **state,
            "trend_candidates": trend_candidates,
            "enriched_trends": enriched_trends,
            "current_step": "trend_retrieval_complete"
        }
    
    async def _research_report_node(self, state: AgentState) -> AgentState:
        """Step 3: Research Report - Generate reviewable report with top 5-10 trends"""
        enriched_trends = state.get("enriched_trends", [])
        query = state["query"]
        scope = state.get("scope", {})
        
        # Select top 5-10 trends (prioritize by recency, source quality, etc.)
        top_trends = enriched_trends[:10] if len(enriched_trends) > 10 else enriched_trends
        
        # Generate confidence scores for each trend
        confidence_scores = {}
        for i, trend in enumerate(top_trends):
            trend_id = f"trend_{i}"
            
            # Calculate confidence based on multiple factors
            confidence_factors = []
            confidence_value = "Medium"
            
            # Factor 1: Source quality
            if trend.get("source") == "tavily":
                confidence_factors.append("High-quality web source")
            elif trend.get("source") == "reddit":
                score = trend.get("score", 0)
                if score > 100:
                    confidence_factors.append("High Reddit engagement")
                else:
                    confidence_factors.append("Moderate Reddit engagement")
            
            # Factor 2: Recency
            try:
                pub_date = trend.get("published_date", "")
                if pub_date:
                    pub_dt = datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
                    days_ago = (datetime.now(pub_dt.tzinfo) - pub_dt).days
                    if days_ago <= 7:
                        confidence_factors.append("Very recent (within 7 days)")
                    elif days_ago <= 30:
                        confidence_factors.append("Recent (within 30 days)")
            except (ValueError, AttributeError, TypeError):
                pass
            
            # Factor 3: Evidence quality
            evidence_count = len(trend.get("key_evidence", []))
            if evidence_count >= 2:
                confidence_factors.append("Multiple supporting sources")
                confidence_value = "High"
            elif evidence_count == 1:
                confidence_factors.append("Single supporting source")
                confidence_value = "Medium"
            else:
                confidence_value = "Low"
            
            confidence_scores[trend_id] = {
                "confidence": confidence_value,
                "rationale": "; ".join(confidence_factors) if confidence_factors else "Standard trend analysis"
            }
        
        # Generate formatted report
        report_prompt = f"""
        Create a comprehensive research report based on these trends for: {query}
        
        Scope: {scope}
        
        Trends to include (top {len(top_trends)}):
        {json.dumps([{"title": t.get("title"), "summary": t.get("summary"), "url": t.get("url")} for t in top_trends], indent=2)}
        
        Format the report as:
        # Research Report: {query}
        
        ## Top Trends
        
        For each trend, include:
        - **Title**: [trend title]
        - **Summary**: [1-2 sentence summary]
        - **Why it matters**: [why this trend is relevant]
        - **Key Links**: [supporting URLs]
        - **Timestamp**: [when this was published/found]
        - **Confidence**: [High/Medium/Low] - [rationale]
        
        Make it clear, reviewable, and actionable.
        """
        
        messages = [
            SystemMessage(content="You are a research report writer. Create clear, structured, reviewable reports."),
            HumanMessage(content=report_prompt)
        ]
        
        response = await self.llm.ainvoke(messages)
        research_report = response.content
        
        # Extract sources from trends
        sources = list(set([t.get("url", "") for t in top_trends if t.get("url")]))
        
        # Format trending topics for backward compatibility
        trending_topics = [
            {
                "topic": t.get("title", ""),
                "reason": t.get("why_it_matters", ""),
                "url": t.get("url", ""),
                "timestamp": t.get("published_date", ""),
                "confidence": confidence_scores.get(f"trend_{i}", {}).get("confidence", "Medium")
            }
            for i, t in enumerate(top_trends)
        ]
        
        return {
            **state,
            "research": research_report,  # For backward compatibility
            "research_report": research_report,
            "sources": sources,
            "trending_topics": trending_topics,
            "confidence_scores": confidence_scores,
            "current_step": "research_report_complete",
            "needs_approval": True
        }
    
    async def _wait_approval_node(self, state: AgentState) -> AgentState:
        """Wait for user approval"""
        session_id = state["session_id"]
        
        # Store state for approval with new fields
        pending_approvals[session_id] = {
            "research": state.get("research", ""),
            "research_report": state.get("research_report", ""),
            "sources": state.get("sources", []),
            "trending_topics": state.get("trending_topics", []),
            "enriched_trends": state.get("enriched_trends", []),
            "confidence_scores": state.get("confidence_scores", {}),
            "scope": state.get("scope", {}),
            "platforms": state["platforms"],
            "original_query": state["query"],
            "state": state
        }
        print(f"Stored approval data for session_id: {session_id}")
        print(f"Pending approvals keys: {list(pending_approvals.keys())}")
        
        return {
            **state,
            "current_step": "waiting_approval",
            "needs_approval": True
        }
    
    def _should_continue(self, state: AgentState) -> str:
        """Determine next step based on approval status"""
        session_id = state["session_id"]
        
        if session_id not in pending_approvals:
            return "waiting"
        
        approval_data = pending_approvals.get(session_id, {})
        if approval_data.get("approved"):
            return "approved"
        elif approval_data.get("needs_refinement"):
            return "needs_refinement"
        else:
            return "waiting"
    
    async def _generate_ideas_node(self, state: AgentState) -> AgentState:
        """Generate marketing copy ideas for each platform"""
        platforms = state["platforms"]
        research = state.get("research_report") or state.get("research", "")
        query = state["query"]
        
        ideas = {}
        
        for platform in platforms:
            platform_prompt = f"""
            Based on this research:
            {research}
            
            Generate 5 creative marketing copy ideas for {platform} that:
            - Are platform-appropriate (consider character limits, tone, format)
            - Incorporate the research insights
            - Are engaging and action-oriented
            - Align with current trends
            
            Original query: {query}
            
            Return as a JSON array of strings, each string being one idea.
            """
            
            messages = [
                SystemMessage(content=f"You are a {platform} marketing copy expert. Generate creative, platform-specific copy ideas."),
                HumanMessage(content=platform_prompt)
            ]
            
            response = await self.llm.ainvoke(messages)
            
            # Parse ideas - handle JSON format and plain text
            try:
                ideas_text = response.content.strip()
                
                # Try to extract JSON array if present
                json_match = re.search(r'\[.*?\]', ideas_text, re.DOTALL)
                if json_match:
                    ideas_list = json.loads(json_match.group())
                    # Clean up each idea
                    ideas_list = [idea.strip().strip('"').strip("'") for idea in ideas_list if idea.strip()]
                else:
                    # Fallback: split by lines and clean
                    ideas_list = []
                    for line in ideas_text.split("\n"):
                        line = line.strip()
                        # Skip markdown code blocks, JSON markers, etc.
                        if line and not line.startswith("```") and not line.startswith("#") and line not in ["[", "]", "{", "}"]:
                            # Remove JSON array markers and quotes
                            cleaned = line.strip('"').strip("'").strip(',').strip()
                            if cleaned and len(cleaned) > 10:  # Only add substantial ideas
                                ideas_list.append(cleaned)
                
                ideas[platform] = ideas_list[:5] if ideas_list else [ideas_text[:200]]  # Limit to 5, fallback to truncated text
            except Exception as e:
                print(f"Error parsing ideas for {platform}: {e}")
                # Fallback: return the raw text, cleaned up
                ideas[platform] = [ideas_text.replace("```json", "").replace("```", "").strip()[:200]]
        
        return {
            **state,
            "ideas": ideas,
            "current_step": "ideas_generated",
            "needs_approval": False
        }
    
    async def run_fast_mode(
        self,
        query: str,
        platforms: List[str],
        session_id: str,
        is_refinement: bool = False,
        mode: str = "fast"
    ) -> AsyncIterator[Dict[str, Any]]:
        """Fast mode: Generate research in one LLM call without multi-step process"""
        yield {
            "type": "step",
            "step": "fast_research",
            "message": "Generating research report (Fast mode)..."
        }
        
        # Single comprehensive prompt to generate all research
        research_prompt = f"""
        You are a marketing research expert. Generate a comprehensive research report for the following query:
        
        Query: {query}
        Target Platforms: {', '.join(platforms)}
        
        Generate a complete research report that includes:
        
        1. A formatted research report (markdown format) with:
           - Title: Research Report: [query]
           - Top 5-10 trending topics relevant to the query
           - For each topic, include:
             * Title
             * Summary (1-2 sentences)
             * Why it matters for marketing
             * Key supporting links/URLs (you can create realistic example URLs or use general domain patterns)
             * Timestamp (recent dates within the last 30 days)
             * Confidence level (High/Medium/Low) with rationale
        
        2. A JSON object with the following structure:
        {{
            "research_report": "[the full markdown research report]",
            "sources": ["list of source URLs"],
            "trending_topics": [
                {{
                    "topic": "topic title",
                    "reason": "why it matters",
                    "url": "source URL",
                    "timestamp": "ISO timestamp",
                    "confidence": "High/Medium/Low"
                }}
            ],
            "enriched_trends": [
                {{
                    "title": "trend title",
                    "summary": "1-2 sentence summary",
                    "why_it_matters": "marketing relevance",
                    "url": "source URL",
                    "published_date": "ISO timestamp",
                    "source": "web",
                    "key_evidence": ["list of supporting URLs"]
                }}
            ],
            "confidence_scores": {{
                "trend_0": {{
                    "confidence": "High/Medium/Low",
                    "rationale": "reasoning for confidence level"
                }}
            }}
        }}
        
        Make the research relevant, actionable, and based on current marketing trends. 
        Generate realistic but relevant trends that would be useful for creating marketing copy.
        """
        
        messages = [
            SystemMessage(content="You are an expert marketing researcher. Generate comprehensive, actionable research reports with structured data."),
            HumanMessage(content=research_prompt)
        ]
        
        response = await self.llm.ainvoke(messages)
        response_text = response.content.strip()
        
        # Parse the response - try to extract JSON first
        research_report = ""
        sources = []
        trending_topics = []
        enriched_trends = []
        confidence_scores = {}
        
        try:
            # Try to find JSON in the response
            json_match = re.search(r'\{.*"trending_topics".*\}', response_text, re.DOTALL)
            if json_match:
                parsed_data = json.loads(json_match.group())
                research_report = parsed_data.get("research_report", response_text)
                sources = parsed_data.get("sources", [])
                trending_topics = parsed_data.get("trending_topics", [])
                enriched_trends = parsed_data.get("enriched_trends", [])
                confidence_scores = parsed_data.get("confidence_scores", {})
            else:
                # If no JSON found, use the entire response as research report
                research_report = response_text
                # Try to extract URLs from the text
                url_pattern = r'https?://[^\s\)]+'
                sources = list(set(re.findall(url_pattern, response_text)))
                # Generate basic trending topics from the report
                trending_topics = [
                    {
                        "topic": f"Trend {i+1}",
                        "reason": "Relevant trend identified in research",
                        "url": sources[i] if i < len(sources) else "",
                        "timestamp": datetime.now().isoformat(),
                        "confidence": "Medium"
                    }
                    for i in range(min(5, len(sources) or 5))
                ]
        except (json.JSONDecodeError, ValueError, AttributeError) as e:
            print(f"Error parsing fast mode response: {e}")
            # Fallback: use entire response as research report
            research_report = response_text
            url_pattern = r'https?://[^\s\)]+'
            sources = list(set(re.findall(url_pattern, response_text)))
            trending_topics = [
                {
                    "topic": f"Trend {i+1}",
                    "reason": "Relevant trend from research",
                    "url": sources[i] if i < len(sources) else "",
                    "timestamp": datetime.now().isoformat(),
                    "confidence": "Medium"
                }
                for i in range(min(5, len(sources) or 5))
            ]
        
        # Ensure we have at least some data
        if not research_report:
            research_report = f"# Research Report: {query}\n\nResearch generated for {query} targeting {', '.join(platforms)}."
        
        if not trending_topics:
            trending_topics = [
                {
                    "topic": f"Relevant trend for {query}",
                    "reason": "Identified through research",
                    "url": "",
                    "timestamp": datetime.now().isoformat(),
                    "confidence": "Medium"
                }
            ]
        
        # Generate confidence scores if not provided
        if not confidence_scores:
            for i, topic in enumerate(trending_topics):
                confidence_scores[f"trend_{i}"] = {
                    "confidence": topic.get("confidence", "Medium"),
                    "rationale": "Fast mode analysis"
                }
        
        # Store in pending approvals
        pending_approvals[session_id] = {
            "research": research_report,
            "research_report": research_report,
            "sources": sources,
            "trending_topics": trending_topics,
            "enriched_trends": enriched_trends,
            "confidence_scores": confidence_scores,
            "scope": {"time_window": "last 30 days", "region": "global", "domain": "general"},
            "platforms": platforms,
            "original_query": query,
            "mode": mode,
            "state": {
                "query": query,
                "platforms": platforms,
                "research": research_report,
                "research_report": research_report,
                "sources": sources,
                "trending_topics": trending_topics,
                "enriched_trends": enriched_trends,
                "confidence_scores": confidence_scores,
            }
        }
        
        # Stream research complete event
        yield {
            "type": "research_complete",
            "research": research_report,
            "research_report": research_report,
            "sources": sources,
            "trending_topics": trending_topics,
            "enriched_trends": enriched_trends,
            "confidence_scores": confidence_scores
        }
        
        # Wait for approval (same pattern as deep mode)
        yield {
            "type": "approval_required",
            "message": "Research complete. Waiting for your approval to proceed.",
            "research": research_report,
            "research_report": research_report,
            "sources": sources,
            "trending_topics": trending_topics,
            "enriched_trends": enriched_trends,
            "confidence_scores": confidence_scores
        }
    
    async def run_stream(
        self,
        query: str,
        platforms: List[str],
        session_id: str,
        is_refinement: bool = False,
        mode: str = "deep"
    ) -> AsyncIterator[Dict[str, Any]]:
        """Run the agent and stream events"""
        # Route to fast mode if requested
        if mode == "fast":
            async for event in self.run_fast_mode(query, platforms, session_id, is_refinement, mode):
                yield event
            return
        
        # Deep mode: use the existing LangGraph workflow
        initial_state = {
            "query": query,
            "platforms": platforms,
            "research": "",
            "sources": [],
            "trending_topics": [],
            "needs_approval": False,
            "approved": False,
            "ideas": {},
            "current_step": "starting",
            "session_id": session_id,
            "scope": {},
            "tools_to_use": [],
            "trend_candidates": [],
            "enriched_trends": [],
            "research_report": "",
            "confidence_scores": {}
        }
        
        # Clear previous approval state if refinement
        if is_refinement and session_id in pending_approvals:
            pending_approvals[session_id] = {
                **pending_approvals[session_id],
                "approved": False,
                "needs_refinement": False
            }
        
        config = {"configurable": {"thread_id": session_id}}
        
        # Stream through the graph
        async for event in self.graph.astream(initial_state, config):
            for node_name, node_output in event.items():
                if node_name == "research_plan":
                    yield {
                        "type": "step",
                        "step": "research_plan",
                        "message": "Clarifying research scope and selecting tools..."
                    }
                    
                    scope = node_output.get("scope", {})
                    tools = node_output.get("tools_to_use", [])
                    
                    yield {
                        "type": "research_plan_complete",
                        "scope": scope,
                        "tools_to_use": tools,
                        "message": f"Scope: {scope.get('time_window', 'N/A')}, {scope.get('region', 'N/A')}, {scope.get('domain', 'N/A')}. Tools: {', '.join(tools)}"
                    }
                
                elif node_name == "trend_retrieval":
                    yield {
                        "type": "step",
                        "step": "trend_retrieval",
                        "message": "Fetching trend candidates and enriching with sources..."
                    }
                    
                    candidates = node_output.get("trend_candidates", [])
                    enriched = node_output.get("enriched_trends", [])
                    
                    # Stream candidates as they're found
                    for candidate in candidates:
                        yield {
                            "type": "trend_candidate",
                            "candidate": {
                                "title": candidate.get("title", ""),
                                "source": candidate.get("source", ""),
                                "url": candidate.get("url", "")
                            }
                        }
                    
                    yield {
                        "type": "trend_retrieval_complete",
                        "candidates_count": len(candidates),
                        "enriched_count": len(enriched),
                        "message": f"Found {len(candidates)} trend candidates, enriched {len(enriched)} trends"
                    }
                
                elif node_name == "synthesize_report":
                    yield {
                        "type": "step",
                        "step": "research_report",
                        "message": "Synthesizing research report..."
                    }
                    
                    # Stream partial report
                    report = node_output.get("research_report", "")
                    if report:
                        yield {
                            "type": "research_report_partial",
                            "content": report[:200] + "..." if len(report) > 200 else report
                        }
                    
                    # Final report
                    yield {
                        "type": "research_complete",
                        "research": node_output.get("research", ""),
                        "research_report": node_output.get("research_report", ""),
                        "sources": node_output.get("sources", []),
                        "trending_topics": node_output.get("trending_topics", []),
                        "enriched_trends": node_output.get("enriched_trends", []),
                        "confidence_scores": node_output.get("confidence_scores", {})
                    }
                
                elif node_name == "wait_approval":
                    print("=== WAIT_APPROVAL NODE OUTPUT ===")
                    print(f"Session ID: {node_output.get('session_id')}")
                    print(f"Research: {node_output.get('research', '')[:100]}...")
                    print(f"Pending approvals after wait_approval: {list(pending_approvals.keys())}")
                    yield {
                        "type": "approval_required",
                        "message": "Research complete. Waiting for your approval to proceed.",
                        "research": node_output.get("research", ""),
                        "research_report": node_output.get("research_report", ""),
                        "sources": node_output.get("sources", []),
                        "trending_topics": node_output.get("trending_topics", []),
                        "enriched_trends": node_output.get("enriched_trends", []),
                        "confidence_scores": node_output.get("confidence_scores", {})
                    }
                
                elif node_name == "generate_step":
                    yield {
                        "type": "step",
                        "step": "generating",
                        "message": "Generating marketing copy ideas..."
                    }
                    
                    ideas = node_output.get("ideas", {})
                    for platform, platform_ideas in ideas.items():
                        yield {
                            "type": "idea_stream",
                            "platform": platform,
                            "ideas": platform_ideas
                        }
                    
                    yield {
                        "type": "complete",
                        "ideas": ideas
                    }
    
    async def continue_after_approval(
        self,
        session_id: str,
        research: str,
        platforms: List[str]
    ) -> AsyncIterator[Dict[str, Any]]:
        """Continue agent execution after approval"""
        if session_id not in pending_approvals:
            raise ValueError("Session not found")
        
        approval_data = pending_approvals[session_id]
        approval_data["approved"] = True
        
        # Run generate_ideas node
        ideas = {}
        for platform in platforms:
            platform_prompt = f"""
            Based on this research:
            {research}
            
            Generate 5 creative marketing copy ideas for {platform}.
            Return as a JSON array of strings.
            """
            
            messages = [
                SystemMessage(content=f"You are a {platform} marketing copy expert."),
                HumanMessage(content=platform_prompt)
            ]
            
            response = await self.llm.ainvoke(messages)
            ideas_text = response.content
            
            # Try to parse as JSON first
            ideas_list = []
            try:
                # Remove markdown code blocks if present
                cleaned_text = ideas_text.strip()
                if cleaned_text.startswith("```json"):
                    cleaned_text = cleaned_text[7:]  # Remove ```json
                if cleaned_text.startswith("```"):
                    cleaned_text = cleaned_text[3:]  # Remove ```
                if cleaned_text.endswith("```"):
                    cleaned_text = cleaned_text[:-3]  # Remove trailing ```
                cleaned_text = cleaned_text.strip()
                
                # Try to parse as JSON array
                parsed = json.loads(cleaned_text)
                if isinstance(parsed, list):
                    ideas_list = [str(idea).strip() for idea in parsed if idea and str(idea).strip()]
                else:
                    raise ValueError("Not a JSON array")
            except (json.JSONDecodeError, ValueError):
                # Fallback to line-by-line parsing
                ideas_list = [idea.strip() for idea in ideas_text.split("\n") 
                            if idea.strip() and not idea.strip().startswith("#") 
                            and not idea.strip().startswith("```")
                            and idea.strip() not in ["[", "]", "{", "}"]]
            
            # Limit to 5 ideas and filter out empty/JSON structure elements
            ideas[platform] = [idea for idea in ideas_list[:5] 
                              if idea and len(idea) > 10 
                              and not idea.startswith("```")
                              and idea not in ["[", "]", "{", "}", "```json", "```"]]
            
            # Stream ideas as they're generated for this platform
            yield {
                "type": "idea_stream",
                "platform": platform,
                "ideas": ideas[platform]
            }
        
        yield {
            "type": "complete",
            "ideas": ideas
        }
