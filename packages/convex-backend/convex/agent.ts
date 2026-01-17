"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  LLM_CONFIG,
  TAVILY_CONFIG,
  PERSONA_DESCRIPTIONS,
  TREND_SOURCES_CONFIG,
  DEFAULT_SCOPE,
  THRESHOLDS,
  SYSTEM_MESSAGES,
  PROMPTS,
  USER_MESSAGES,
  getPersonaContext,
  getPersonaCopyContext,
} from "./config";

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

// LangGraph State Definition using Annotation
const AgentStateAnnotation = Annotation.Root({
  // Input parameters
  query: Annotation<string>,
  platforms: Annotation<string[]>,
  persona: Annotation<"author" | "founder" | undefined>,
  sessionId: Annotation<string>,
  mode: Annotation<string>, // "fast" | "deep"
  isRefinement: Annotation<boolean>,

  // Research pipeline state
  scope: Annotation<{ time_window: string; region: string; domain: string }>,
  toolsToUse: Annotation<string[]>,
  trendCandidates: Annotation<Array<{
    title: string;
    content: string;
    url: string;
    published_date: string;
    source: string;
    raw_data: any;
    score?: number;
    comments?: number;
    subreddit?: string;
  }>>,
  enrichedTrends: Annotation<Array<{
    title: string;
    summary: string;
    why_it_matters: string;
    url: string;
    published_date: string;
    source: string;
    key_evidence: string[];
  }>>,
  researchReport: Annotation<string>,
  research: Annotation<string>,
  sources: Annotation<string[]>,
  trendingTopics: Annotation<Array<{
    topic: string;
    reason: string;
    url?: string;
    timestamp?: string;
    confidence?: string;
  }>>,
  confidenceScores: Annotation<Record<string, { confidence: string; rationale: string }>>,

  // Approval & generation state
  needsApproval: Annotation<boolean>,
  approved: Annotation<boolean>,
  ideas: Annotation<Record<string, string[]>>,

  // Execution tracking
  currentStep: Annotation<string>,

  // Streaming support - events to yield
  streamEvents: Annotation<Array<{
    type: string;
    [key: string]: any;
  }>>,
});

// Type alias for convenience
type AgentState = typeof AgentStateAnnotation.State;

// Pending approvals are now stored in the database via sessions.ts

class MarketingCopyAgent {
  private llm: ChatOpenAI;
  private tavilyApiKey: string | null;
  private composioApiKey: string | null;
  private composioUserId: string | null;
  private composioMcpUrl: string | null;
  private deepModeGraph: any; // StateGraph instance for deep mode
  private fastModeGraph: any; // StateGraph instance for fast mode

  constructor() {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set. Please set it using: npx convex env set OPENAI_API_KEY <your-key>");
    }
    this.llm = new ChatOpenAI({
      modelName: LLM_CONFIG.modelName,
      temperature: LLM_CONFIG.temperature,
      openAIApiKey: openaiApiKey,
    });
    this.tavilyApiKey = process.env.TAVILY_API_KEY || null;
    this.composioApiKey = process.env.COMPOSIO_API_KEY || null;
    this.composioUserId = process.env.COMPOSIO_USER_ID || null;
    this.composioMcpUrl = null;
    this.deepModeGraph = null; // Will be initialized when needed
    this.fastModeGraph = null; // Will be initialized when needed
  }

  private normalizePlatformName(platform: string): string {
    const platformLower = platform.toLowerCase().trim();
    if (platformLower === "x" || platformLower === "twitter") {
      return "x";
    }
    return platformLower;
  }

  // Helper to add stream event to state
  private addStreamEvent(state: AgentState, event: any): Partial<AgentState> {
    return {
      streamEvents: [...(state.streamEvents || []), event],
    };
  }

  // LangGraph Node: Fast Mode Research
  private fastModeNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const query = state.query;
    const platforms = state.platforms;
    const persona = state.persona;

    // Collect all events
    const events: any[] = [];

    // Emit step event
    events.push({
      type: "step",
      step: "fast_research",
      message: USER_MESSAGES.fastResearch
    });

    const researchPrompt = PROMPTS.fastModeResearch(query, platforms, persona);
    const systemMessage = SYSTEM_MESSAGES.marketingResearcher(
      persona,
      persona ? PERSONA_DESCRIPTIONS[persona] : undefined
    );

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
        trendingTopics = sources.slice(0, THRESHOLDS.fallbackTrendCount).map((url, i) => ({
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

    events.push({
      type: "research_complete",
      research: researchReport,
      research_report: researchReport,
      sources,
      trending_topics: trendingTopics,
      enriched_trends: enrichedTrends,
      confidence_scores: confidenceScores
    });

    events.push({
      type: "approval_required",
      message: USER_MESSAGES.approvalRequired,
      research: researchReport,
      research_report: researchReport,
      sources,
      trending_topics: trendingTopics,
      enriched_trends: enrichedTrends,
      confidence_scores: confidenceScores
    });

    return {
      streamEvents: [...(state.streamEvents || []), ...events],
      research: researchReport,
      researchReport,
      sources,
      trendingTopics,
      enrichedTrends,
      confidenceScores,
      needsApproval: true,
      currentStep: "fast_research_complete",
    };
  };

  // LangGraph Node: Research Plan
  private researchPlanNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const query = state.query;
    
    // Collect all events
    const events: any[] = [];

    // Emit step event
    events.push({
      type: "step",
      step: "research_plan",
      message: USER_MESSAGES.researchPlan
    });

    const scopePrompt = PROMPTS.scopeAnalysis(query);

    const messages = [
      new SystemMessage(SYSTEM_MESSAGES.researchPlanningAssistant),
      new HumanMessage(scopePrompt)
    ];

    const response = await this.llm.invoke(messages);
    const scopeText = typeof response.content === 'string' ? response.content : String(response.content);
    
    // Parse scope from response
    let scope: { time_window: string; region: string; domain: string } = { ...DEFAULT_SCOPE };
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

    events.push({
      type: "research_plan_complete",
      scope,
      tools_to_use: toolsToUse,
      message: `Scope: ${scope.time_window}, ${scope.region}, ${scope.domain}. Tools: ${toolsToUse.join(", ")}`
    });

    return {
      streamEvents: [...(state.streamEvents || []), ...events],
      scope,
      toolsToUse,
      currentStep: "research_plan_complete"
    };
  };


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
      const platformDomains = TREND_SOURCES_CONFIG[normalizedPlatform] || [];
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
        search_depth: TAVILY_CONFIG.searchDepth,
        max_results: TAVILY_CONFIG.maxResults,
      };

      if (uniqueDomains.length > 0) {
        searchParams.include_domains = uniqueDomains;
      }

      const response = await fetch(TAVILY_CONFIG.apiEndpoint, {
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

  // LangGraph Node: Trend Retrieval
  private trendRetrievalNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const query = state.query;
    const scope = state.scope || { ...DEFAULT_SCOPE };
    const toolsToUse = state.toolsToUse || [];
    const platforms = state.platforms;

    // Collect all events
    const events: any[] = [];

    // Emit step event
    events.push({
      type: "step",
      step: "trend_retrieval",
      message: USER_MESSAGES.trendRetrieval
    });

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

    // Emit trend candidate events
    for (const candidate of trendCandidates) {
      events.push({
        type: "trend_candidate",
        candidate: {
          title: candidate.title,
          source: candidate.source,
          url: candidate.url
        }
      });
    }

    // Enrich trends with LLM
    const enrichedTrends: any[] = [];
    for (const candidate of trendCandidates.slice(0, THRESHOLDS.maxTrendsToEnrich)) {
      const enrichmentPrompt = PROMPTS.trendEnrichment(candidate);

      try {
        const messages = [
          new SystemMessage(SYSTEM_MESSAGES.trendAnalysisExpert),
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
            summary: enrichmentText.substring(0, THRESHOLDS.fallbackTextLength),
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

    events.push({
      type: "trend_retrieval_complete",
      candidates_count: trendCandidates.length,
      enriched_count: enrichedTrends.length,
      message: `Found ${trendCandidates.length} trend candidates, enriched ${enrichedTrends.length} trends`
    });

    return {
      streamEvents: [...(state.streamEvents || []), ...events],
      trendCandidates,
      enrichedTrends,
      currentStep: "trend_retrieval_complete"
    };
  };

  // LangGraph Node: Research Report
  private researchReportNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const enrichedTrends = state.enrichedTrends || [];
    const query = state.query;
    const scope = state.scope || {};

    // Collect all events
    const events: any[] = [];

    // Emit step event
    events.push({
      type: "step",
      step: "research_report",
      message: USER_MESSAGES.researchReport
    });

    const topTrends = enrichedTrends.slice(0, THRESHOLDS.maxTrendsForReport);

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
        if (score > THRESHOLDS.redditHighEngagement) {
          confidenceFactors.push("High Reddit engagement");
        } else {
          confidenceFactors.push("Moderate Reddit engagement");
        }
      }

      const evidenceCount = (trend.key_evidence || []).length;
      if (evidenceCount >= THRESHOLDS.minEvidenceForHighConfidence) {
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
    const personaContext = getPersonaContext(persona);

    // Generate formatted report
    const reportPrompt = PROMPTS.researchReport(
      query,
      scope,
      topTrends.map((t: any) => ({ title: t.title, summary: t.summary, url: t.url })),
      persona
    );

    const systemMessage = SYSTEM_MESSAGES.researchReportWriter(
      persona,
      persona ? PERSONA_DESCRIPTIONS[persona] : undefined
    );

    const messages = [
      new SystemMessage(systemMessage),
      new HumanMessage(reportPrompt)
    ];

    const response = await this.llm.invoke(messages);
    const researchReport = typeof response.content === 'string' ? response.content : String(response.content);

    // Extract sources
    const sources = Array.from(new Set(topTrends.map((t: any) => t.url).filter(Boolean)));

    // Format trending topics
    const trendingTopics = topTrends.map((t: any, i: number) => ({
      topic: t.title || "",
      reason: t.why_it_matters || "",
      url: t.url || "",
      timestamp: t.published_date || "",
      confidence: confidenceScores[`trend_${i}`]?.confidence || "Medium"
    }));

    events.push({
      type: "research_complete",
      research: researchReport,
      research_report: researchReport,
      sources,
      trending_topics: trendingTopics,
      enriched_trends: enrichedTrends,
      confidence_scores: confidenceScores
    });

    events.push({
      type: "approval_required",
      message: USER_MESSAGES.approvalRequired,
      research: researchReport,
      research_report: researchReport,
      sources,
      trending_topics: trendingTopics,
      enriched_trends: enrichedTrends,
      confidence_scores: confidenceScores
    });

    return {
      streamEvents: [...(state.streamEvents || []), ...events],
      research: researchReport,
      researchReport,
      sources,
      trendingTopics,
      confidenceScores,
      currentStep: "research_report_complete",
      needsApproval: true
    };
  };

  // LangGraph Node: Generate Ideas
  private generateIdeasNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const platforms = state.platforms;
    const research = state.researchReport || state.research || "";
    const query = state.query;
    const persona = state.persona;

    // Collect all events
    const events: any[] = [];

    const ideas: Record<string, string[]> = {};

    for (const platform of platforms) {
      const platformPrompt = PROMPTS.platformCopyGenerationSimple(research, platform, persona);

      const systemMessage = SYSTEM_MESSAGES.marketingCopyExpertSimple(
        platform,
        persona,
        persona ? PERSONA_DESCRIPTIONS[persona] : undefined
      );

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
          ideasList = parsed.map((idea: any) => String(idea).trim()).filter((idea: string) => idea.length > THRESHOLDS.minIdeaLength);
        }
      } catch (error) {
        ideasList = ideasText
          .split("\n")
          .map((line: string) => line.trim())
          .filter((line: string) => line && !line.startsWith("#") && !line.startsWith("```") && !["[", "]", "{", "}"].includes(line))
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > THRESHOLDS.minIdeaLength);
      }

      ideas[platform] = ideasList.slice(0, THRESHOLDS.maxIdeasPerPlatform).filter((idea: string) => 
        idea && idea.length > THRESHOLDS.minIdeaLength && 
        !idea.startsWith("```") && 
        idea !== "```json" && 
        idea !== "```"
      );

      // Emit idea stream event
      events.push({
        type: "idea_stream",
        platform,
        ideas: ideas[platform]
      });
    }

    events.push({
      type: "complete",
      ideas
    });

    return {
      streamEvents: [...(state.streamEvents || []), ...events],
      ideas,
      currentStep: "ideas_generated",
      needsApproval: false
    };
  };

  // Conditional edge function: Check if approval is needed
  private checkApproval = (state: AgentState): string => {
    if (state.needsApproval && !state.approved) {
      return "end"; // Exit graph, wait for external approval
    }
    return "generate_ideas"; // Continue to idea generation
  };

  // Build Deep Mode Graph
  private buildDeepModeGraph(): any {
    const graph = new StateGraph(AgentStateAnnotation)
      .addNode("research_plan", this.researchPlanNode)
      .addNode("trend_retrieval", this.trendRetrievalNode)
      .addNode("research_report", this.researchReportNode)
      .addNode("generate_ideas", this.generateIdeasNode);

    // Add edges - deep mode goes straight to research_plan
    graph.addEdge(START, "research_plan");
    graph.addEdge("research_plan", "trend_retrieval");
    graph.addEdge("trend_retrieval", "research_report");
    graph.addConditionalEdges(
      "research_report",
      this.checkApproval,
      {
        end: END,
        generate_ideas: "generate_ideas"
      }
    );
    graph.addEdge("generate_ideas", END);

    return graph.compile();
  }

  // Build Fast Mode Graph
  private buildFastModeGraph(): any {
    const graph = new StateGraph(AgentStateAnnotation)
      .addNode("fast_mode", this.fastModeNode);

    // Add edges - fast mode goes straight to fast_mode
    graph.addEdge(START, "fast_mode");
    graph.addConditionalEdges(
      "fast_mode",
      this.checkApproval,
      {
        end: END,
        generate_ideas: END // Fast mode doesn't generate ideas in the graph
      }
    );

    return graph.compile();
  }

  // Transform LangGraph state updates to streaming events
  private *transformGraphEvents(state: AgentState): Generator<any, void, unknown> {
    // Yield all accumulated stream events
    for (const event of state.streamEvents || []) {
      yield event;
    }
  }

  async *runFastMode(
    query: string,
    platforms: string[],
    sessionId: string,
    mode: string = "fast",
    persona?: "author" | "founder"
  ): AsyncGenerator<any, void, unknown> {
    // Initialize graph if needed
    if (!this.fastModeGraph) {
      this.fastModeGraph = this.buildFastModeGraph();
    }

    // Initial state
    const initialState: AgentState = {
      query,
      platforms,
      persona,
      sessionId,
      mode: "fast",
      isRefinement: false,
      research: "",
      sources: [],
      trendingTopics: [],
      needsApproval: false,
      approved: false,
      ideas: {},
      currentStep: "starting",
      scope: { ...DEFAULT_SCOPE },
      toolsToUse: [],
      trendCandidates: [],
      enrichedTrends: [],
      researchReport: "",
      confidenceScores: {},
      streamEvents: [],
    };

    // Use stream() instead of invoke() to get incremental state updates
    let lastEventCount = 0;
    const stream = await this.fastModeGraph.stream(initialState, {
      configurable: { thread_id: sessionId }
    });
    
    for await (const chunk of stream) {
      // LangGraph stream returns chunks with node names as keys
      // Extract the state from the chunk
      const stateUpdate = Object.values(chunk)[0] as AgentState;
      if (stateUpdate && stateUpdate.streamEvents) {
        // Extract new events that haven't been yielded yet
        const currentEvents = stateUpdate.streamEvents;
        const newEvents = currentEvents.slice(lastEventCount);
        
        // Yield new events as they come in
        for (const event of newEvents) {
          yield event;
        }
        
        lastEventCount = currentEvents.length;
      }
    }
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
    if (!this.deepModeGraph) {
      this.deepModeGraph = this.buildDeepModeGraph();
    }
    
    // Initial state
    const initialState: AgentState = {
      query,
      platforms,
      persona,
      sessionId,
      mode: "deep",
      isRefinement,
      research: "",
      sources: [],
      trendingTopics: [],
      needsApproval: false,
      approved: false,
      ideas: {},
      currentStep: "starting",
      scope: { ...DEFAULT_SCOPE },
      toolsToUse: [],
      trendCandidates: [],
      enrichedTrends: [],
      researchReport: "",
      confidenceScores: {},
      streamEvents: [],
    };

    // Use stream() instead of invoke() to get incremental state updates
    // This allows us to yield events as they happen, not just at the end
    let lastEventCount = 0;
    const stream = await this.deepModeGraph.stream(initialState, {
      configurable: { thread_id: sessionId }
    });
    
    for await (const chunk of stream) {
      // LangGraph stream returns chunks with node names as keys
      // Extract the state from the chunk
      const stateUpdate = Object.values(chunk)[0] as AgentState;
      if (stateUpdate && stateUpdate.streamEvents) {
        // Extract new events that haven't been yielded yet
        const currentEvents = stateUpdate.streamEvents;
        const newEvents = currentEvents.slice(lastEventCount);
        
        // Yield new events as they come in
        for (const event of newEvents) {
          yield event;
        }
        
        lastEventCount = currentEvents.length;
      }
    }
  }

  async *continueAfterApproval(
    sessionId: string,
    research: string,
    platforms: string[],
    persona?: "author" | "founder",
    ctx?: any
  ): AsyncGenerator<any, void, unknown> {
    // Build a simple graph for idea generation after approval
    const ideaGraph = new StateGraph(AgentStateAnnotation)
      .addNode("generate_ideas", this.generateIdeasNode);

    ideaGraph.addEdge(START, "generate_ideas");
    ideaGraph.addEdge("generate_ideas", END);

    const compiledGraph = ideaGraph.compile();

    // Initial state with approved research
    const initialState: AgentState = {
      query: "", // Not needed for idea generation
      platforms,
      persona,
      sessionId,
      mode: "deep",
      isRefinement: false,
      research,
      researchReport: research,
      sources: [],
      trendingTopics: [],
      needsApproval: false,
      approved: true, // Mark as approved to skip approval check
      ideas: {},
      currentStep: "generating_ideas",
      scope: { ...DEFAULT_SCOPE },
      toolsToUse: [],
      trendCandidates: [],
      enrichedTrends: [],
      confidenceScores: {},
      streamEvents: [],
    };

    // Use stream() instead of invoke() to get incremental state updates
    let lastEventCount = 0;
    const stream = await compiledGraph.stream(initialState, {
      configurable: { thread_id: sessionId }
    });
    
    for await (const chunk of stream) {
      // LangGraph stream returns chunks with node names as keys
      // Extract the state from the chunk
      const stateUpdate = Object.values(chunk)[0] as AgentState;
      if (stateUpdate && stateUpdate.streamEvents) {
        // Extract new events that haven't been yielded yet
        const currentEvents = stateUpdate.streamEvents;
        const newEvents = currentEvents.slice(lastEventCount);
        
        // Yield new events as they come in
        for (const event of newEvents) {
          yield event;
        }
        
        lastEventCount = currentEvents.length;
      }
    }
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
          scope: { ...DEFAULT_SCOPE },
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
            scope: approvalData.scope || { ...DEFAULT_SCOPE },
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
