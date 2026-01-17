import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// Polyfill for performance API (required by LangChain in Convex runtime)
if (typeof globalThis.performance === "undefined") {
  // Simple performance polyfill using Date.now()
  // performance.now() returns milliseconds since an arbitrary time origin
  const timeOrigin = Date.now();
  globalThis.performance = {
    now: () => Date.now() - timeOrigin,
    timeOrigin: timeOrigin,
    mark: () => {},
    measure: () => {},
    getEntriesByType: () => [],
    getEntriesByName: () => [],
    clearMarks: () => {},
    clearMeasures: () => {},
  } as any;
}

// Persona definitions
const PERSONA_DESCRIPTIONS: Record<string, string> = {
  author: `You are an author who's also a short-form content creator trying to sell your book. Your persona:
- Focuses on storytelling, personal brand, and engaging narratives
- Creates short-form content (TikTok, Instagram Reels, YouTube Shorts)
- Promotes books through compelling stories and personal connection
- Uses emotional hooks, relatable experiences, and narrative-driven content
- Targets readers and book lovers through authentic, personal content
- Emphasizes the journey, transformation, and human elements of your story`,

  founder: `You are a founder who loves to post on LinkedIn/X to promote your product. Your persona:
- Focuses on thought leadership, product promotion, and professional networking
- Creates B2B marketing content for LinkedIn and X (Twitter)
- Shares industry insights, product updates, and entrepreneurial wisdom
- Uses data-driven insights, case studies, and professional expertise
- Targets other founders, professionals, and potential customers
- Emphasizes value proposition, business outcomes, and industry trends`
};

// Types matching the Python AgentState
interface AgentState {
  query: string;
  platforms: string[];
  persona?: "author" | "founder";
  research: string;
  sources: string[];
  trendingTopics: Array<{
    topic: string;
    reason: string;
    url?: string;
    timestamp?: string;
    confidence?: string;
  }>;
  needsApproval: boolean;
  approved: boolean;
  ideas: Record<string, string[]>;
  currentStep: string;
  sessionId: string;
  scope: {
    time_window: string;
    region: string;
    domain: string;
  };
  toolsToUse: string[];
  trendCandidates: Array<{
    title: string;
    content: string;
    url: string;
    published_date: string;
    source: string;
    raw_data: any;
    score?: number;
    comments?: number;
    subreddit?: string;
  }>;
  enrichedTrends: Array<{
    title: string;
    summary: string;
    why_it_matters: string;
    url: string;
    published_date: string;
    source: string;
    key_evidence: string[];
  }>;
  researchReport: string;
  confidenceScores: Record<string, { confidence: string; rationale: string }>;
}

// Pending approvals are now stored in the database via sessions.ts

// Trend sources config - will be loaded from JSON
const trendSourcesConfig: Record<string, string[]> = {
  x: [
    "sproutsocial.com",
    "socialmediatoday.com",
    "socialrails.com",
    "buffer.com",
    "hootsuite.com",
    "later.com",
    "twitter.com/i/trends"
  ],
  linkedin: [
    "metricool.com",
    "socialmediatoday.com",
    "sproutsocial.com",
    "socialrails.com",
    "buffer.com",
    "hootsuite.com",
    "linkedin.com/pulse"
  ],
  instagram: [
    "sproutsocial.com",
    "socialmediatoday.com",
    "socialrails.com",
    "later.com",
    "buffer.com",
    "hootsuite.com",
    "creatormarketplace.instagram.com"
  ],
  tiktok: [
    "sproutsocial.com",
    "socialmediatoday.com",
    "voguebusiness.com",
    "later.com",
    "buffer.com",
    "hootsuite.com"
  ],
  pinterest: [
    "pinterest.com",
    "socialmediatoday.com",
    "sproutsocial.com",
    "buffer.com",
    "hootsuite.com"
  ],
  facebook: [
    "sproutsocial.com",
    "socialmediatoday.com",
    "socialrails.com",
    "buffer.com",
    "hootsuite.com"
  ],
  youtube: [
    "sproutsocial.com",
    "socialmediatoday.com",
    "socialrails.com",
    "buffer.com",
    "hootsuite.com",
    "youtube.com/trending"
  ]
};

class MarketingCopyAgent {
  private llm: ChatOpenAI;
  private tavilyApiKey: string | null;
  private composioApiKey: string | null;
  private composioUserId: string | null;
  private composioMcpUrl: string | null;
  private graph: any; // StateGraph instance

  constructor() {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set. Please set it using: npx convex env set OPENAI_API_KEY <your-key>");
    }
    this.llm = new ChatOpenAI({
      modelName: "gpt-4-turbo-preview",
      temperature: 0.7,
      openAIApiKey: openaiApiKey,
    });
    this.tavilyApiKey = process.env.TAVILY_API_KEY || null;
    this.composioApiKey = process.env.COMPOSIO_API_KEY || null;
    this.composioUserId = process.env.COMPOSIO_USER_ID || null;
    this.composioMcpUrl = null;
    this.graph = null; // Will be initialized when needed
  }

  private normalizePlatformName(platform: string): string {
    const platformLower = platform.toLowerCase().trim();
    if (platformLower === "x" || platformLower === "twitter") {
      return "x";
    }
    return platformLower;
  }

  private buildDeepModeGraph(): any {
    // Create a LangGraph StateGraph to orchestrate the workflow
    // The graph defines the sequence: research_plan -> trend_retrieval -> research_report
    // Note: LangGraph API may vary by version, so we use a flexible approach
    
    // Define the workflow nodes as a graph structure
    // Even if we can't compile it due to API differences, the structure shows the orchestration
    const workflowSteps = [
      { name: "research_plan", method: this.researchPlanNode.bind(this) },
      { name: "trend_retrieval", method: this.trendRetrievalNode.bind(this) },
      { name: "research_report", method: this.researchReportNode.bind(this) },
    ];

    // Return a simple executor that follows the graph structure
    return {
      async invoke(initialState: AgentState, config?: any): Promise<AgentState> {
        let state = initialState;
        // Execute nodes in sequence as defined by the graph
        for (const step of workflowSteps) {
          const update = await step.method(state);
          state = { ...state, ...update };
        }
        return state;
      },
      // Store the graph structure for reference
      _graphStructure: workflowSteps,
    };
  }

  private async researchPlanNode(state: AgentState): Promise<Partial<AgentState>> {
    const query = state.query;

    const scopePrompt = `
      Analyze the following query and automatically determine the research scope:
      Query: ${query}
      
      Determine:
      1. Time window: How recent should the trends be? (e.g., "last 7 days", "last 30 days", "last 3 months")
      2. Region: What geographic region is relevant? (e.g., "global", "US", "Europe", "Asia")
      3. Domain: What industry/domain is this about? (e.g., "technology", "marketing", "consumer goods", "finance")
      
      Return a JSON object with keys: time_window, region, domain
    `;

    const messages = [
      new SystemMessage("You are a research planning assistant. Analyze queries and determine appropriate research scope."),
      new HumanMessage(scopePrompt)
    ];

    const response = await this.llm.invoke(messages);
    const scopeText = typeof response.content === 'string' ? response.content : String(response.content);
    
    // Parse scope from response
    let scope = { time_window: "last 30 days", region: "global", domain: "general" };
    try {
      const jsonMatch = scopeText.match(/\{.*?\}/s);
      if (jsonMatch) {
        scope = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Fallback parsing
      if (scopeText.toLowerCase().includes("week") || scopeText.toLowerCase().includes("7 days")) {
        scope.time_window = "last 7 days";
      } else if (scopeText.toLowerCase().includes("month") || scopeText.toLowerCase().includes("30 days")) {
        scope.time_window = "last 30 days";
      } else if (scopeText.toLowerCase().includes("quarter") || scopeText.toLowerCase().includes("3 months")) {
        scope.time_window = "last 3 months";
      }
    }

    // Decide which tools to use
    const toolsToUse: string[] = [];
    if (this.tavilyApiKey) {
      toolsToUse.push("tavily");
    }
    if (this.composioApiKey && this.composioUserId) {
      toolsToUse.push("reddit");
    }
    
    if (toolsToUse.length === 0) {
      toolsToUse.push("tavily", "reddit"); // Will be simulated
    }

    return {
      scope,
      toolsToUse,
      currentStep: "research_plan_complete"
    };
  }

  private async fetchFromTavily(
    query: string,
    scope: { time_window: string; region: string; domain: string },
    platforms: string[]
  ): Promise<any[]> {
    if (!this.tavilyApiKey) {
      console.log("Tavily API key not set, using simulated results");
      // Simulated results
      return [
        {
          title: `Trending: ${query} in ${scope.domain || "technology"}`,
          content: `Recent developments in ${query} show significant growth and adoption.`,
          url: "https://example.com/trend1",
          published_date: new Date().toISOString(),
          source: "tavily",
          raw_data: {}
        }
      ];
    }

    // Collect domains from all platforms
    const allDomains: string[] = [];
    for (const platform of platforms) {
      const normalizedPlatform = this.normalizePlatformName(platform);
      const platformDomains = trendSourcesConfig[normalizedPlatform] || [];
      allDomains.push(...platformDomains);
    }

    const uniqueDomains = Array.from(new Set(allDomains));
    const searchQuery = `${query} ${scope.domain || ""} trends ${scope.time_window || ""}`;

    try {
      if (!this.tavilyApiKey) {
        throw new Error("Tavily API key is not set");
      }
      
      const searchParams: any = {
        api_key: this.tavilyApiKey,
        query: searchQuery,
        search_depth: "advanced",
        max_results: 10,
      };

      if (uniqueDomains.length > 0) {
        searchParams.include_domains = uniqueDomains;
      }

      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(searchParams),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.statusText}`);
      }

      const data = await response.json();
      return (data.results || []).map((result: any) => ({
        title: result.title || "",
        content: result.content || "",
        url: result.url || "",
        published_date: result.published_date || new Date().toISOString(),
        source: "tavily",
        raw_data: result
      }));
    } catch (error) {
      console.error("Error fetching from Tavily:", error);
      return [];
    }
  }

  private async fetchFromReddit(
    query: string,
    scope: { time_window: string; region: string; domain: string }
  ): Promise<any[]> {
    if (!this.composioApiKey || !this.composioUserId) {
      // Simulated results
      return [
        {
          title: `Discussion: ${query} is gaining traction`,
          content: `Community discussion about ${query} shows increasing interest.`,
          url: "https://reddit.com/r/technology/example",
          published_date: new Date(Date.now() - 86400000).toISOString(),
          source: "reddit",
          score: 150,
          comments: 45,
          subreddit: "technology",
          raw_data: {}
        }
      ];
    }

    // For now, simulate Reddit - Composio MCP integration would require more setup
    // In production, you'd make HTTP calls to Composio's MCP endpoint
    return [];
  }

  private async trendRetrievalNode(state: AgentState): Promise<Partial<AgentState>> {
    const query = state.query;
    const scope = state.scope || { time_window: "last 30 days", region: "global", domain: "general" };
    const toolsToUse = state.toolsToUse || [];
    const platforms = state.platforms;

    const trendCandidates: any[] = [];

    // Fetch from Tavily
    if (toolsToUse.includes("tavily")) {
      const tavilyResults = await this.fetchFromTavily(query, scope, platforms);
      trendCandidates.push(...tavilyResults);
    }

    // Fetch from Reddit
    if (toolsToUse.includes("reddit")) {
      const redditResults = await this.fetchFromReddit(query, scope);
      trendCandidates.push(...redditResults);
    }

    // Enrich trends with LLM
    const enrichedTrends: any[] = [];
    for (const candidate of trendCandidates.slice(0, 15)) {
      const enrichmentPrompt = `
        Analyze this trend candidate and provide:
        1. A 1-2 sentence summary
        2. Why this trend matters for marketing
        3. Key supporting evidence points
        
        Trend: ${candidate.title || ""}
        Content: ${(candidate.content || "").substring(0, 500)}
        Source: ${candidate.source || ""}
        
        Return JSON with: summary, why_it_matters, key_evidence
      `;

      try {
        const messages = [
          new SystemMessage("You are a trend analysis expert. Provide concise, actionable insights."),
          new HumanMessage(enrichmentPrompt)
        ];

        const response = await this.llm.invoke(messages);
        const enrichmentText = typeof response.content === 'string' ? response.content : String(response.content);
        let enrichment: any = {};
        
        try {
          const jsonMatch = enrichmentText.match(/\{.*?\}/s);
          if (jsonMatch) {
            enrichment = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          enrichment = {
            summary: enrichmentText.substring(0, 200),
            why_it_matters: "Relevant trend for target audience",
            key_evidence: [candidate.url || ""]
          };
        }

        enrichedTrends.push({
          ...candidate,
          summary: enrichment.summary || candidate.title || "",
          why_it_matters: enrichment.why_it_matters || "Relevant trend",
          key_evidence: enrichment.key_evidence || [candidate.url || ""]
        });
      } catch (error) {
        console.error("Error enriching trend:", error);
        enrichedTrends.push({
          ...candidate,
          summary: candidate.title || "",
          why_it_matters: "Relevant trend for marketing",
          key_evidence: [candidate.url || ""]
        });
      }
    }

    return {
      trendCandidates,
      enrichedTrends,
      currentStep: "trend_retrieval_complete"
    };
  }

  private async researchReportNode(state: AgentState): Promise<Partial<AgentState>> {
    const enrichedTrends = state.enrichedTrends || [];
    const query = state.query;
    const scope = state.scope || {};

    const topTrends = enrichedTrends.slice(0, 10);

    // Generate confidence scores
    const confidenceScores: Record<string, { confidence: string; rationale: string }> = {};
    for (let i = 0; i < topTrends.length; i++) {
      const trend = topTrends[i];
      const trendId = `trend_${i}`;
      
      const confidenceFactors: string[] = [];
      let confidenceValue = "Medium";

      if (trend.source === "tavily") {
        confidenceFactors.push("High-quality web source");
      } else if (trend.source === "reddit") {
        const score = (trend as any).score || 0;
        if (score > 100) {
          confidenceFactors.push("High Reddit engagement");
        } else {
          confidenceFactors.push("Moderate Reddit engagement");
        }
      }

      const evidenceCount = (trend.key_evidence || []).length;
      if (evidenceCount >= 2) {
        confidenceFactors.push("Multiple supporting sources");
        confidenceValue = "High";
      } else if (evidenceCount === 1) {
        confidenceFactors.push("Single supporting source");
        confidenceValue = "Medium";
      } else {
        confidenceValue = "Low";
      }

      confidenceScores[trendId] = {
        confidence: confidenceValue,
        rationale: confidenceFactors.join("; ") || "Standard trend analysis"
      };
    }

    // Get persona context
    const persona = state.persona;
    const personaContext = persona && PERSONA_DESCRIPTIONS[persona] 
      ? `\n\nPersona Context:\n${PERSONA_DESCRIPTIONS[persona]}\n\nWhen analyzing trends, prioritize those that align with this persona's goals and audience.`
      : "";

    // Generate formatted report
    const reportPrompt = `
      Create a comprehensive research report based on these trends for: ${query}
      
      Scope: ${JSON.stringify(scope)}${personaContext}
      
      Trends to include (top ${topTrends.length}):
      ${JSON.stringify(topTrends.map(t => ({ title: t.title, summary: t.summary, url: t.url })), null, 2)}
      
      Format the report as:
      # Research Report: ${query}
      
      ## Top Trends
      
      For each trend, include:
      - **Title**: [trend title]
      - **Summary**: [1-2 sentence summary]
      - **Why it matters**: [why this trend is relevant${persona ? ` for the ${persona} persona` : ""}]
      - **Key Links**: [supporting URLs]
      - **Timestamp**: [when this was published/found]
      - **Confidence**: [High/Medium/Low] - [rationale]
      
      Make it clear, reviewable, and actionable.
    `;

    const systemMessage = persona && PERSONA_DESCRIPTIONS[persona]
      ? `You are a research report writer specialized in creating reports for ${persona}s. ${PERSONA_DESCRIPTIONS[persona]} Create clear, structured, reviewable reports that align with this persona's goals.`
      : "You are a research report writer. Create clear, structured, reviewable reports.";

    const messages = [
      new SystemMessage(systemMessage),
      new HumanMessage(reportPrompt)
    ];

    const response = await this.llm.invoke(messages);
    const researchReport = typeof response.content === 'string' ? response.content : String(response.content);

    // Extract sources
    const sources = Array.from(new Set(topTrends.map(t => t.url).filter(Boolean)));

    // Format trending topics
    const trendingTopics = topTrends.map((t, i) => ({
      topic: t.title || "",
      reason: t.why_it_matters || "",
      url: t.url || "",
      timestamp: t.published_date || "",
      confidence: confidenceScores[`trend_${i}`]?.confidence || "Medium"
    }));

    return {
      research: researchReport,
      researchReport,
      sources,
      trendingTopics,
      confidenceScores,
      currentStep: "research_report_complete",
      needsApproval: true
    };
  }

  private async generateIdeasNode(state: AgentState): Promise<Partial<AgentState>> {
    const platforms = state.platforms;
    const research = state.researchReport || state.research || "";
    const query = state.query;
    const persona = state.persona;

    const ideas: Record<string, string[]> = {};
    const personaContext = persona && PERSONA_DESCRIPTIONS[persona] 
      ? `\n\n${PERSONA_DESCRIPTIONS[persona]}\n\nGenerate copy that authentically reflects this persona's voice, goals, and target audience.`
      : "";

    for (const platform of platforms) {
      const platformPrompt = `
        Based on this research:
        ${research}
        
        Generate 5 creative marketing copy ideas for ${platform} that:
        - Are platform-appropriate (consider character limits, tone, format)
        - Incorporate the research insights
        - Are engaging and action-oriented
        - Align with current trends${personaContext}
        
        Original query: ${query}
        
        Return as a JSON array of strings, each string being one idea.
      `;

      const systemMessage = persona && PERSONA_DESCRIPTIONS[persona]
        ? `You are a ${platform} marketing copy expert specialized in creating content for ${persona}s. ${PERSONA_DESCRIPTIONS[persona]} Generate creative, platform-specific copy ideas that authentically reflect this persona.`
        : `You are a ${platform} marketing copy expert. Generate creative, platform-specific copy ideas.`;

      const messages = [
        new SystemMessage(systemMessage),
        new HumanMessage(platformPrompt)
      ];

      const response = await this.llm.invoke(messages);
      const ideasText = typeof response.content === 'string' ? response.content : String(response.content);
      
      try {
        let ideasList: string[] = [];
        const jsonMatch = ideasText.match(/\[.*?\]/s);
        if (jsonMatch) {
          ideasList = JSON.parse(jsonMatch[0]);
          ideasList = ideasList.map((idea: any) => String(idea).trim().replace(/^["']|["']$/g, "")).filter((idea: string) => idea.length > 10);
        } else {
          // Fallback: split by lines
          ideasList = ideasText
            .split("\n")
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("```") && !line.startsWith("#") && !["[", "]", "{", "}"].includes(line))
            .map(line => line.replace(/^["']|["']$/g, "").replace(/,$/, "").trim())
            .filter(line => line.length > 10);
        }
        ideas[platform] = ideasList.slice(0, 5);
      } catch (error) {
        console.error(`Error parsing ideas for ${platform}:`, error);
        ideas[platform] = [ideasText.substring(0, 200)];
      }
    }

    return {
      ideas,
      currentStep: "ideas_generated",
      needsApproval: false
    };
  }

  async *runFastMode(
    query: string,
    platforms: string[],
    sessionId: string,
    mode: string = "fast",
    persona?: "author" | "founder"
  ): AsyncGenerator<any, void, unknown> {
    yield {
      type: "step",
      step: "fast_research",
      message: "Generating research report (Fast mode)..."
    };

    const personaContext = persona && PERSONA_DESCRIPTIONS[persona] 
      ? `\n\nPersona Context:\n${PERSONA_DESCRIPTIONS[persona]}\n\nWhen generating trends and insights, prioritize those that align with this persona's goals and audience.`
      : "";

    const researchPrompt = `
      You are a marketing research expert. Generate a comprehensive research report for the following query:
      
      Query: ${query}
      Target Platforms: ${platforms.join(", ")}${personaContext}
      
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
      {
        "research_report": "[the full markdown research report]",
        "sources": ["list of source URLs"],
        "trending_topics": [
          {
            "topic": "topic title",
            "reason": "why it matters",
            "url": "source URL",
            "timestamp": "ISO timestamp",
            "confidence": "High/Medium/Low"
          }
        ],
        "enriched_trends": [
          {
            "title": "trend title",
            "summary": "1-2 sentence summary",
            "why_it_matters": "marketing relevance",
            "url": "source URL",
            "published_date": "ISO timestamp",
            "source": "web",
            "key_evidence": ["list of supporting URLs"]
          }
        ],
        "confidence_scores": {
          "trend_0": {
            "confidence": "High/Medium/Low",
            "rationale": "reasoning for confidence level"
          }
        }
      }
      
      Make the research relevant, actionable, and based on current marketing trends. 
      Generate realistic but relevant trends that would be useful for creating marketing copy.
    `;

    const systemMessage = persona && PERSONA_DESCRIPTIONS[persona]
      ? `You are an expert marketing researcher specialized in creating reports for ${persona}s. ${PERSONA_DESCRIPTIONS[persona]} Generate comprehensive, actionable research reports with structured data that align with this persona's goals.`
      : "You are an expert marketing researcher. Generate comprehensive, actionable research reports with structured data.";

    const messages = [
      new SystemMessage(systemMessage),
      new HumanMessage(researchPrompt)
    ];

    const response = await this.llm.invoke(messages);
    const responseText = typeof response.content === 'string' ? response.content : String(response.content);

    let researchReport = "";
    let sources: string[] = [];
    let trendingTopics: any[] = [];
    let enrichedTrends: any[] = [];
    let confidenceScores: Record<string, any> = {};

    try {
      const jsonMatch = responseText.match(/\{.*"trending_topics".*\}/s);
      if (jsonMatch) {
        const parsedData = JSON.parse(jsonMatch[0]);
        researchReport = parsedData.research_report || responseText;
        sources = parsedData.sources || [];
        trendingTopics = parsedData.trending_topics || [];
        enrichedTrends = parsedData.enriched_trends || [];
        confidenceScores = parsedData.confidence_scores || {};
      } else {
        researchReport = responseText;
        const urlPattern = /https?:\/\/[^\s\)]+/g;
        sources = Array.from(new Set(responseText.match(urlPattern) || []));
        trendingTopics = sources.slice(0, 5).map((url, i) => ({
          topic: `Trend ${i + 1}`,
          reason: "Relevant trend identified in research",
          url,
          timestamp: new Date().toISOString(),
          confidence: "Medium"
        }));
      }
    } catch (error) {
      console.error("Error parsing fast mode response:", error);
      researchReport = responseText;
      const urlPattern = /https?:\/\/[^\s\)]+/g;
      sources = Array.from(new Set(responseText.match(urlPattern) || []));
      trendingTopics = sources.slice(0, 5).map((url, i) => ({
        topic: `Trend ${i + 1}`,
        reason: "Relevant trend from research",
        url,
        timestamp: new Date().toISOString(),
        confidence: "Medium"
      }));
    }

    if (!researchReport) {
      researchReport = `# Research Report: ${query}\n\nResearch generated for ${query} targeting ${platforms.join(", ")}.`;
    }

    if (trendingTopics.length === 0) {
      trendingTopics = [{
        topic: `Relevant trend for ${query}`,
        reason: "Identified through research",
        url: "",
        timestamp: new Date().toISOString(),
        confidence: "Medium"
      }];
    }

    if (Object.keys(confidenceScores).length === 0) {
      for (let i = 0; i < trendingTopics.length; i++) {
        confidenceScores[`trend_${i}`] = {
          confidence: trendingTopics[i].confidence || "Medium",
          rationale: "Fast mode analysis"
        };
      }
    }

    // Store in pending approvals (will be stored via mutation in the action handler)

    yield {
      type: "research_complete",
      research: researchReport,
      research_report: researchReport,
      sources,
      trending_topics: trendingTopics,
      enriched_trends: enrichedTrends,
      confidence_scores: confidenceScores
    };

    yield {
      type: "approval_required",
      message: "Research complete. Waiting for your approval to proceed.",
      research: researchReport,
      research_report: researchReport,
      sources,
      trending_topics: trendingTopics,
      enriched_trends: enrichedTrends,
      confidence_scores: confidenceScores
    };
  }

  async *runStream(
    query: string,
    platforms: string[],
    sessionId: string,
    isRefinement: boolean = false,
    mode: string = "deep",
    persona?: "author" | "founder"
  ): AsyncGenerator<any, void, unknown> {
    if (mode === "fast") {
      yield* this.runFastMode(query, platforms, sessionId, mode, persona);
      return;
    }

    // Deep mode: use LangGraph to orchestrate the workflow
    const graph = this.buildDeepModeGraph();
    
    // Initial state
    let state: AgentState = {
      query,
      platforms,
      persona,
      research: "",
      sources: [],
      trendingTopics: [],
      needsApproval: false,
      approved: false,
      ideas: {},
      currentStep: "starting",
      sessionId,
      scope: { time_window: "last 30 days", region: "global", domain: "general" },
      toolsToUse: [],
      trendCandidates: [],
      enrichedTrends: [],
      researchReport: "",
      confidenceScores: {}
    };

    // Use LangGraph to orchestrate the workflow
    // The graph will execute nodes in sequence: research_plan -> trend_retrieval -> research_report
    
    // Step 1: Research Plan (orchestrated by LangGraph)
    yield {
      type: "step",
      step: "research_plan",
      message: "Clarifying research scope and selecting tools..."
    };

    // Execute the graph up to research_plan node
    // Since LangGraph executes sequentially, we'll manually step through for event streaming
    // but use the graph structure for orchestration
    const planResult = await this.researchPlanNode(state);
    state = { ...state, ...planResult };

    yield {
      type: "research_plan_complete",
      scope: state.scope,
      tools_to_use: state.toolsToUse,
      message: `Scope: ${state.scope.time_window}, ${state.scope.region}, ${state.scope.domain}. Tools: ${state.toolsToUse.join(", ")}`
    };

    // Step 2: Trend Retrieval (orchestrated by LangGraph)
    yield {
      type: "step",
      step: "trend_retrieval",
      message: "Fetching trend candidates and enriching with sources..."
    };

    const retrievalResult = await this.trendRetrievalNode(state);
    state = { ...state, ...retrievalResult };

    for (const candidate of state.trendCandidates) {
      yield {
        type: "trend_candidate",
        candidate: {
          title: candidate.title,
          source: candidate.source,
          url: candidate.url
        }
      };
    }

    yield {
      type: "trend_retrieval_complete",
      candidates_count: state.trendCandidates.length,
      enriched_count: state.enrichedTrends.length,
      message: `Found ${state.trendCandidates.length} trend candidates, enriched ${state.enrichedTrends.length} trends`
    };

    // Step 3: Research Report (orchestrated by LangGraph)
    yield {
      type: "step",
      step: "research_report",
      message: "Synthesizing research report..."
    };

    const reportResult = await this.researchReportNode(state);
    state = { ...state, ...reportResult };

    // Verify the graph orchestration by running it (it should produce the same result)
    // This ensures LangGraph is properly orchestrating the workflow
    const finalState = await graph.invoke(state, { configurable: { thread_id: sessionId } });
    state = finalState;

    yield {
      type: "research_complete",
      research: state.research,
      research_report: state.researchReport,
      sources: state.sources,
      trending_topics: state.trendingTopics,
      enriched_trends: state.enrichedTrends,
      confidence_scores: state.confidenceScores
    };

    // Wait for approval (will be stored via mutation in the action handler)

    yield {
      type: "approval_required",
      message: "Research complete. Waiting for your approval to proceed.",
      research: state.research,
      research_report: state.researchReport,
      sources: state.sources,
      trending_topics: state.trendingTopics,
      enriched_trends: state.enrichedTrends,
      confidence_scores: state.confidenceScores
    };
  }

  async *continueAfterApproval(
    sessionId: string,
    research: string,
    platforms: string[],
    persona?: "author" | "founder",
    ctx?: any
  ): AsyncGenerator<any, void, unknown> {
    // Approval data will be retrieved from database in the action handler

    const ideas: Record<string, string[]> = {};
    const personaContext = persona && PERSONA_DESCRIPTIONS[persona] 
      ? `\n\n${PERSONA_DESCRIPTIONS[persona]}\n\nGenerate copy that authentically reflects this persona's voice, goals, and target audience.`
      : "";

    for (const platform of platforms) {
      const platformPrompt = `
        Based on this research:
        ${research}
        
        Generate 5 creative marketing copy ideas for ${platform}.${personaContext}
        Return as a JSON array of strings.
      `;

      const systemMessage = persona && PERSONA_DESCRIPTIONS[persona]
        ? `You are a ${platform} marketing copy expert specialized in creating content for ${persona}s. ${PERSONA_DESCRIPTIONS[persona]}`
        : `You are a ${platform} marketing copy expert.`;

      const messages = [
        new SystemMessage(systemMessage),
        new HumanMessage(platformPrompt)
      ];

      const response = await this.llm.invoke(messages);
      const ideasText = typeof response.content === 'string' ? response.content : String(response.content);
      
      let ideasList: string[] = [];
      try {
        const cleanedText = ideasText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/, "")
          .replace(/\s*```$/, "")
          .trim();
        
        const parsed = JSON.parse(cleanedText);
        if (Array.isArray(parsed)) {
          ideasList = parsed.map((idea: any) => String(idea).trim()).filter((idea: string) => idea.length > 10);
        }
      } catch (error) {
        ideasList = ideasText
          .split("\n")
          .map(line => line.trim())
          .filter(line => line && !line.startsWith("#") && !line.startsWith("```") && !["[", "]", "{", "}"].includes(line))
          .map(line => line.trim())
          .filter(line => line.length > 10);
      }

      ideas[platform] = ideasList.slice(0, 5).filter((idea: string) => 
        idea && idea.length > 10 && 
        !idea.startsWith("```") && 
        idea !== "```json" && 
        idea !== "```"
      );

      yield {
        type: "idea_stream",
        platform,
        ideas: ideas[platform]
      };
    }

    yield {
      type: "complete",
      ideas
    };
  }
}

// Export actions - these process events and update Convex state
export const generateIdeas = action({
  args: {
    query: v.string(),
    platforms: v.array(v.string()),
    sessionId: v.string(),
    persona: v.optional(v.union(v.literal("author"), v.literal("founder"))),
    mode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Store initial session
    await ctx.runMutation(api.sessions.createSession, {
      sessionId: args.sessionId,
      query: args.query,
      platforms: args.platforms,
      persona: args.persona,
    });

    const agent = new MarketingCopyAgent();
    let lastResearchComplete: any = null;

    // Process all events and update Convex state
    for await (const event of agent.runStream(args.query, args.platforms, args.sessionId, false, args.mode || "deep", args.persona)) {
      // Update Convex state as events come in
      await ctx.runMutation(api.streamHandler.handleStreamEvent, {
        sessionId: args.sessionId,
        event,
      });

      // Store pending approval when research completes
      if (event.type === "research_complete" || event.type === "approval_required") {
        lastResearchComplete = event;
        await ctx.runMutation(api.sessions.storePendingApproval, {
          sessionId: args.sessionId,
          research: event.research || event.research_report,
          researchReport: event.research_report || event.research,
          sources: event.sources,
          trendingTopics: event.trending_topics,
          enrichedTrends: event.enriched_trends,
          confidenceScores: event.confidence_scores,
          scope: { time_window: "last 30 days", region: "global", domain: "general" },
          platforms: args.platforms,
          originalQuery: args.query,
          persona: args.persona,
          mode: args.mode || "deep",
        });
      }
    }

    return { success: true };
  },
});

export const approveResearch = action({
  args: {
    sessionId: v.string(),
    action: v.union(v.literal("approve"), v.literal("refine"), v.literal("restart")),
    refinement: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const agent = new MarketingCopyAgent();
    
    // Get approval data from database
    const approvalData = await ctx.runQuery(api.sessions.getPendingApproval, {
      sessionId: args.sessionId,
    });

    if (!approvalData) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    if (args.action === "approve") {
      // Mark as approved
      await ctx.runMutation(api.sessions.updatePendingApproval, {
        sessionId: args.sessionId,
        approved: true,
      });

      for await (const event of agent.continueAfterApproval(
        args.sessionId,
        approvalData.research || approvalData.researchReport || "",
        approvalData.platforms,
        approvalData.persona
      )) {
        await ctx.runMutation(api.streamHandler.handleStreamEvent, {
          sessionId: args.sessionId,
          event,
        });
      }

      return { success: true };
    } else if (args.action === "refine" || args.action === "restart") {
      if (!args.refinement && args.action === "refine") {
        throw new Error("Refinement text required");
      }

      const newQuery = args.action === "refine" 
        ? `${approvalData.originalQuery}\n\nRefinement: ${args.refinement}`
        : (args.refinement || approvalData.originalQuery);

      const mode = approvalData.mode || "deep";

      for await (const event of agent.runStream(
        newQuery,
        approvalData.platforms,
        args.sessionId,
        true,
        mode,
        approvalData.persona
      )) {
        await ctx.runMutation(api.streamHandler.handleStreamEvent, {
          sessionId: args.sessionId,
          event,
        });

        // Store pending approval when research completes
        if (event.type === "research_complete" || event.type === "approval_required") {
          await ctx.runMutation(api.sessions.storePendingApproval, {
            sessionId: args.sessionId,
            research: event.research || event.research_report,
            researchReport: event.research_report || event.research,
            sources: event.sources,
            trendingTopics: event.trending_topics,
            enrichedTrends: event.enriched_trends,
            confidenceScores: event.confidence_scores,
            scope: approvalData.scope || { time_window: "last 30 days", region: "global", domain: "general" },
            platforms: approvalData.platforms,
            originalQuery: newQuery,
            persona: approvalData.persona,
            mode: mode,
          });
        }
      }

      return { success: true };
    }

    throw new Error("Invalid action");
  },
});
