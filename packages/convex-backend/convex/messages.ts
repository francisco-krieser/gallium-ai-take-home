import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const addMessage = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      type: args.type,
      content: args.content,
      platform: args.platform,
      ideas: args.ideas,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
  },
});

export const getMessages = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

export const deleteMessages = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }
  },
});
