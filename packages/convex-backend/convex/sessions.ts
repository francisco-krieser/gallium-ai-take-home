import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createSession = mutation({
  args: {
    sessionId: v.string(),
    query: v.string(),
    platforms: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("sessions", {
      sessionId: args.sessionId,
      query: args.query,
      platforms: args.platforms,
      status: "researching",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateSession = mutation({
  args: {
    sessionId: v.string(),
    query: v.optional(v.string()),
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
    status: v.optional(v.union(
      v.literal("researching"),
      v.literal("waiting_approval"),
      v.literal("generating"),
      v.literal("complete")
    )),
  },
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    await ctx.db.patch(session._id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const updateIdeas = mutation({
  args: {
    sessionId: v.string(),
    platform: v.string(),
    ideas: v.array(v.string()),
    status: v.optional(v.union(
      v.literal("researching"),
      v.literal("waiting_approval"),
      v.literal("generating"),
      v.literal("complete")
    )),
  },
  handler: async (ctx, args) => {
    const { sessionId, platform, ideas, status } = args;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    const currentIdeas = session.ideas || {};
    currentIdeas[platform] = ideas;

    // Only update status if explicitly provided, and never override "complete" status
    const updateData: any = {
      ideas: currentIdeas,
      updatedAt: Date.now(),
    };
    
    // Only update status if:
    // 1. Status is provided
    // 2. Current status is not "complete" (never override complete)
    if (status && session.status !== "complete") {
      updateData.status = status;
    }

    await ctx.db.patch(session._id, updateData);
  },
});

export const getSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
  },
});

export const listSessions = query({
  handler: async (ctx) => {
    return await ctx.db.query("sessions").order("desc").take(10);
  },
});

export const resetSession = mutation({
  args: { 
    sessionId: v.string(),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    // Reset session to initial state
    await ctx.db.patch(session._id, {
      query: args.query || session.query,
      research: undefined,
      sources: undefined,
      trendingTopics: undefined,
      ideas: undefined,
      status: "researching",
      updatedAt: Date.now(),
    });
  },
});

// Pending approvals management
export const storePendingApproval = mutation({
  args: {
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
    mode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pendingApprovals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    const data = {
      sessionId: args.sessionId,
      research: args.research,
      researchReport: args.researchReport,
      sources: args.sources,
      trendingTopics: args.trendingTopics,
      enrichedTrends: args.enrichedTrends,
      confidenceScores: args.confidenceScores,
      scope: args.scope,
      platforms: args.platforms,
      originalQuery: args.originalQuery,
      mode: args.mode,
      approved: false,
      needsRefinement: false,
      createdAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("pendingApprovals", data);
    }
  },
});

export const getPendingApproval = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pendingApprovals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
  },
});

export const updatePendingApproval = mutation({
  args: {
    sessionId: v.string(),
    approved: v.optional(v.boolean()),
    needsRefinement: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pendingApprovals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!existing) {
      throw new Error("Pending approval not found");
    }

    await ctx.db.patch(existing._id, {
      approved: args.approved,
      needsRefinement: args.needsRefinement,
    });
  },
});
