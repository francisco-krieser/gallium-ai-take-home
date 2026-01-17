// LLM Configuration
export const LLM_CONFIG = {
  modelName: "gpt-4o-mini",
  temperature: 0.7,
} as const;

// Tavily API Configuration
export const TAVILY_CONFIG = {
  apiEndpoint: "https://api.tavily.com/search",
  searchDepth: "advanced",
  maxResults: 10,
} as const;

// Persona Definitions
export const PERSONA_DESCRIPTIONS: Record<string, string> = {
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
- Emphasizes value proposition, business outcomes, and industry trends`,
};

// Trend Sources Configuration - Curated domains per platform
export const TREND_SOURCES_CONFIG: Record<string, string[]> = {
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

// Default Scope Configuration
export const DEFAULT_SCOPE = {
  time_window: "last 30 days",
  region: "global",
  domain: "general"
} as const;

// Thresholds and Limits
export const THRESHOLDS = {
  redditHighEngagement: 100,
  minEvidenceForHighConfidence: 2,
  maxTrendsToEnrich: 15,
  maxTrendsForReport: 10,
  maxIdeasPerPlatform: 5,
  minIdeaLength: 10,
  fallbackTrendCount: 5,
  fallbackTextLength: 200,
} as const;

// System Messages
export const SYSTEM_MESSAGES = {
  researchPlanningAssistant: "You are a research planning assistant. Analyze queries and determine appropriate research scope.",
  
  trendAnalysisExpert: "You are a trend analysis expert. Provide concise, actionable insights.",
  
  researchReportWriter: (persona?: string, personaDescription?: string) => {
    if (persona && personaDescription) {
      return `You are a research report writer specialized in creating reports for ${persona}s. ${personaDescription} Create clear, structured, reviewable reports that align with this persona's goals.`;
    }
    return "You are a research report writer. Create clear, structured, reviewable reports.";
  },
  
  marketingCopyExpert: (platform: string, persona?: string, personaDescription?: string) => {
    if (persona && personaDescription) {
      return `You are a ${platform} marketing copy expert specialized in creating content for ${persona}s. ${personaDescription} Generate creative, platform-specific copy ideas that authentically reflect this persona.`;
    }
    return `You are a ${platform} marketing copy expert. Generate creative, platform-specific copy ideas.`;
  },
  
  marketingCopyExpertSimple: (platform: string, persona?: string, personaDescription?: string) => {
    if (persona && personaDescription) {
      return `You are a ${platform} marketing copy expert specialized in creating content for ${persona}s. ${personaDescription}`;
    }
    return `You are a ${platform} marketing copy expert.`;
  },
  
  marketingResearcher: (persona?: string, personaDescription?: string) => {
    if (persona && personaDescription) {
      return `You are an expert marketing researcher specialized in creating reports for ${persona}s. ${personaDescription} Generate comprehensive, actionable research reports with structured data that align with this persona's goals.`;
    }
    return "You are an expert marketing researcher. Generate comprehensive, actionable research reports with structured data.";
  },
};

// Prompt Templates
export const PROMPTS = {
  scopeAnalysis: (query: string) => `
    Analyze the following query and automatically determine the research scope:
    Query: ${query}
    
    Determine:
    1. Time window: How recent should the trends be? (e.g., "last 7 days", "last 30 days", "last 3 months")
    2. Region: What geographic region is relevant? (e.g., "global", "US", "Europe", "Asia")
    3. Domain: What industry/domain is this about? (e.g., "technology", "marketing", "consumer goods", "finance")
    
    Return a JSON object with keys: time_window, region, domain
  `,
  
  trendEnrichment: (candidate: { title?: string; content?: string; source?: string }) => `
    Analyze this trend candidate and provide:
    1. A 1-2 sentence summary
    2. Why this trend matters for marketing
    3. Key supporting evidence points
    
    Trend: ${candidate.title || ""}
    Content: ${(candidate.content || "").substring(0, 500)}
    Source: ${candidate.source || ""}
    
    Return JSON with: summary, why_it_matters, key_evidence
  `,
  
  researchReport: (
    query: string,
    scope: { time_window: string; region: string; domain: string },
    topTrends: Array<{ title?: string; summary?: string; url?: string }>,
    persona?: string
  ) => `
    Create a comprehensive research report based on these trends for: ${query}
    
    Scope: ${JSON.stringify(scope)}${persona ? `\n\nPersona Context:\n${PERSONA_DESCRIPTIONS[persona] || ""}\n\nWhen analyzing trends, prioritize those that align with this persona's goals and audience.` : ""}
    
    Trends to include (top ${topTrends.length}):
    ${JSON.stringify(topTrends, null, 2)}
    
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
  `,
  
  platformCopyGeneration: (
    research: string,
    platform: string,
    query: string,
    persona?: string
  ) => {
    const personaContext = persona && PERSONA_DESCRIPTIONS[persona]
      ? `\n\n${PERSONA_DESCRIPTIONS[persona]}\n\nGenerate copy that authentically reflects this persona's voice, goals, and target audience.`
      : "";
    
    return `
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
  },
  
  platformCopyGenerationSimple: (
    research: string,
    platform: string,
    persona?: string
  ) => {
    const personaContext = persona && PERSONA_DESCRIPTIONS[persona]
      ? `\n\n${PERSONA_DESCRIPTIONS[persona]}\n\nGenerate copy that authentically reflects this persona's voice, goals, and target audience.`
      : "";
    
    return `
      Based on this research:
      ${research}
      
      Generate 5 creative marketing copy ideas for ${platform}.${personaContext}
      Return as a JSON array of strings.
    `;
  },
  
  fastModeResearch: (
    query: string,
    platforms: string[],
    persona?: string
  ) => {
    const personaContext = persona && PERSONA_DESCRIPTIONS[persona]
      ? `\n\nPersona Context:\n${PERSONA_DESCRIPTIONS[persona]}\n\nWhen generating trends and insights, prioritize those that align with this persona's goals and audience.`
      : "";
    
    return `
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
  },
};

// User-Facing Messages
export const USER_MESSAGES = {
  fastResearch: "Generating research report (Fast mode)...",
  researchPlan: "Clarifying research scope and selecting tools...",
  trendRetrieval: "Fetching trend candidates and enriching with sources...",
  researchReport: "Synthesizing research report...",
  approvalRequired: "Research complete. Waiting for your approval to proceed.",
};

// Helper function to get persona context string
export const getPersonaContext = (persona?: string, prefix: string = "\n\nPersona Context:\n"): string => {
  if (persona && PERSONA_DESCRIPTIONS[persona]) {
    return `${prefix}${PERSONA_DESCRIPTIONS[persona]}\n\nWhen analyzing trends, prioritize those that align with this persona's goals and audience.`;
  }
  return "";
};

// Helper function to get persona description for copy generation
export const getPersonaCopyContext = (persona?: string): string => {
  if (persona && PERSONA_DESCRIPTIONS[persona]) {
    return `\n\n${PERSONA_DESCRIPTIONS[persona]}\n\nGenerate copy that authentically reflects this persona's voice, goals, and target audience.`;
  }
  return "";
};
