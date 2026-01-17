import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

export const generateIdeas = action({
  args: {
    query: v.string(),
    platforms: v.array(v.string()),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Store initial session
    await ctx.runMutation(api.sessions.createSession, {
      sessionId: args.sessionId,
      query: args.query,
      platforms: args.platforms,
    });

    // Return the FastAPI URL for the frontend to stream from
    return {
      streamUrl: `${FASTAPI_URL}/generate`,
      sessionId: args.sessionId,
    };
  },
});

export const approveResearch = action({
  args: {
    sessionId: v.string(),
    action: v.union(v.literal("approve"), v.literal("refine"), v.literal("restart")),
    refinement: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Return the FastAPI URL for the frontend to stream from
    return {
      streamUrl: `${FASTAPI_URL}/approve`,
      sessionId: args.sessionId,
    };
  },
});
