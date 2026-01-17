import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    sessionId: v.string(),
    query: v.string(),
    platforms: v.array(v.string()),
    persona: v.optional(v.union(v.literal("author"), v.literal("founder"))),
    research: v.optional(v.string()),
    sources: v.optional(v.array(v.string())),
    trendingTopics: v.optional(v.array(v.object({
      topic: v.string(),
      reason: v.string(),
      url: v.optional(v.string()),
      timestamp: v.optional(v.string()),
      confidence: v.optional(v.string()),
    }))),
    ideas: v.optional(v.any()),
    status: v.union(
      v.literal("researching"),
      v.literal("waiting_approval"),
      v.literal("generating"),
      v.literal("complete")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_session", ["sessionId"]),

  messages: defineTable({
    sessionId: v.string(),
    type: v.union(
      v.literal("user"),
      v.literal("system"),
      v.literal("step"),
      v.literal("research"),
      v.literal("approval"),
      v.literal("idea")
    ),
    content: v.string(),
    platform: v.optional(v.string()),
    ideas: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  }).index("by_session", ["sessionId"]),

  pendingApprovals: defineTable({
    sessionId: v.string(),
    research: v.optional(v.string()),
    researchReport: v.optional(v.string()),
    sources: v.optional(v.array(v.string())),
    trendingTopics: v.optional(v.array(v.object({
      topic: v.string(),
      reason: v.string(),
      url: v.optional(v.string()),
      timestamp: v.optional(v.string()),
      confidence: v.optional(v.string()),
    }))),
    enrichedTrends: v.optional(v.any()),
    confidenceScores: v.optional(v.any()),
    scope: v.optional(v.any()),
    platforms: v.array(v.string()),
    originalQuery: v.string(),
    persona: v.optional(v.union(v.literal("author"), v.literal("founder"))),
    mode: v.optional(v.string()),
    approved: v.optional(v.boolean()),
    needsRefinement: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_session", ["sessionId"]),
});
