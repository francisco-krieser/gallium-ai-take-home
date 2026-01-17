import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Helper mutations to update state from streaming events
export const handleStreamEvent = mutation({
  args: {
    sessionId: v.string(),
    event: v.any(),
  },
  handler: async (ctx, args) => {
    const { sessionId, event } = args;

    // Get current session to accumulate partial findings
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
      .first();

    // Store message (skip for complete event and research_partial - they're handled separately)
    // research_partial events are not stored as separate messages - they update the research message
    if (event.type !== "complete" && event.type !== "research_partial") {
      // Format content based on event type
      let content = event.message || event.research;
      let messageType: string = "system";
      
      if (event.type === "step") {
        messageType = "step";
        content = event.message || "Processing...";
      } else if (event.type === "research_complete") {
        messageType = "research";
        content = event.research || event.message || "Research completed";
      } else if (event.type === "approval_required") {
        messageType = "approval";
        content = event.message || "Research complete. Waiting for your approval to proceed.";
      } else if (event.type === "idea_stream") {
        messageType = "idea";
        content = `Generated ${event.ideas?.length || 0} ideas for ${event.platform}`;
      } else if (event.type === "research_plan_complete") {
        // Don't create a message for scope - it's not needed in the UI
        return;
      } else if (event.type === "trend_candidate") {
        // Accumulate trend candidates and update session incrementally
        if (session) {
          const currentTrendingTopics = session.trendingTopics || [];
          const newTopic = {
            topic: event.candidate?.title || "Trending topic",
            reason: `Found from ${event.candidate?.source || "web"}`,
            url: event.candidate?.url || "",
            timestamp: new Date().toISOString(),
            confidence: "Medium"
          };
          
          // Check if this topic already exists (avoid duplicates)
          const exists = currentTrendingTopics.some(
            (t: any) => t.url === newTopic.url || t.topic === newTopic.topic
          );
          
          if (!exists) {
            const updatedTopics = [...currentTrendingTopics, newTopic];
            
            // Update session with new trending topics
            await ctx.runMutation(api.sessions.updateSession, {
              sessionId,
              trendingTopics: updatedTopics,
            });
            
            // Create a research message with partial findings
            const partialResearch = formatPartialResearch(updatedTopics, session.sources || []);
            await ctx.runMutation(api.sessions.updateSession, {
              sessionId,
              research: partialResearch,
            });
            
            // Create or update research message
            await ctx.runMutation(api.messages.addMessage, {
              sessionId,
              type: "research",
              content: partialResearch,
              metadata: { isPartial: true, trendCount: updatedTopics.length },
            });
          }
        }
        return;
      } else if (event.type === "trend_retrieval_complete") {
        messageType = "step";
        content = `Found ${event.candidates_count || 0} trend candidates, enriched ${event.enriched_count || 0} trends`;
        
        // Update session with enriched trends if available
        if (session && event.enriched_trends && Array.isArray(event.enriched_trends)) {
          const enrichedTopics = event.enriched_trends.map((trend: any, index: number) => ({
            topic: trend.title || trend.topic || `Trend ${index + 1}`,
            reason: trend.why_it_matters || trend.reason || "Relevant trend for marketing",
            url: trend.url || "",
            timestamp: trend.published_date || new Date().toISOString(),
            confidence: "Medium"
          }));
          
          await ctx.runMutation(api.sessions.updateSession, {
            sessionId,
            trendingTopics: enrichedTopics,
          });
          
          // Update research with enriched trends
          const partialResearch = formatPartialResearch(enrichedTopics, session.sources || []);
          await ctx.runMutation(api.sessions.updateSession, {
            sessionId,
            research: partialResearch,
          });
          
          // Create research message with enriched trends
          await ctx.runMutation(api.messages.addMessage, {
            sessionId,
            type: "research",
            content: partialResearch,
            metadata: { isPartial: true, trendCount: enrichedTopics.length },
          });
        }
        
        // Also create the step message for progress indication
        await ctx.runMutation(api.messages.addMessage, {
          sessionId,
          type: messageType as any,
          content: content,
          metadata: event,
        });
        return;
      } else if (event.type === "research_report_partial") {
        // Don't create messages for partial reports
        return;
      } else {
        // For unknown event types, try to format nicely
        if (event.message) {
          content = event.message;
        } else if (event.content) {
          content = event.content;
        } else {
          // Last resort: format the event nicely instead of raw JSON
          content = `[${event.type}] ${JSON.stringify(event, null, 2)}`;
        }
      }
      
      if (event.type !== "trend_candidate" && event.type !== "trend_retrieval_complete") {
        await ctx.runMutation(api.messages.addMessage, {
          sessionId,
          type: messageType as any,
          content: content,
          platform: event.platform,
          ideas: Array.isArray(event.ideas) ? event.ideas : undefined,
          metadata: event,
        });
      }
    }

    // Update session state
    if (event.type === "research_complete") {
      await ctx.runMutation(api.sessions.updateSession, {
        sessionId,
        research: event.research,
        sources: event.sources,
        trendingTopics: event.trending_topics,
        status: "waiting_approval",
      });
    } else if (event.type === "approval_required") {
      // Update session with research data from approval_required event
      await ctx.runMutation(api.sessions.updateSession, {
        sessionId,
        research: event.research || event.research_report,
        sources: event.sources,
        trendingTopics: event.trending_topics,
        status: "waiting_approval",
      });
    } else if (event.type === "idea_stream") {
      console.log("Processing idea_stream event for platform:", event.platform, "Ideas count:", event.ideas?.length)
      // Clean up ideas - parse JSON strings if needed
      let cleanedIdeas = event.ideas || []
      if (Array.isArray(cleanedIdeas) && cleanedIdeas.length > 0) {
        // Filter out JSON structure elements first
        const filtered = cleanedIdeas.filter((item: any) => {
          const str = String(item).trim()
          // Filter out JSON markers and structure elements
          return str !== "```json" && 
                 str !== "```" && 
                 str !== "[" && 
                 str !== "]" && 
                 str !== "," &&
                 str.length > 0 &&
                 !str.match(/^[\[\]{}",\s]+$/) // Filter out pure JSON structure strings
        })
        
        cleanedIdeas = filtered.map((idea: any) => {
          if (typeof idea === 'string') {
            let cleaned = idea
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/, '')
              .replace(/\s*```$/, '')
              .replace(/^\[\s*/, '')
              .replace(/\s*\]$/, '')
              .trim()
              // Remove leading/trailing quotes and commas more carefully
              cleaned = cleaned.replace(/^["',\s]+/, '').replace(/["',\s]+$/, '')
              // Remove escaped characters
              cleaned = cleaned.replace(/\\"/g, '"').replace(/\\n/g, ' ')
              // Remove trailing commas
              cleaned = cleaned.replace(/,\s*$/, '')
            return cleaned
          }
          return String(idea)
        }).filter((idea: string) => {
          // Less aggressive filtering - only filter out obvious JSON structure elements
          const str = String(idea).trim()
          // Keep ideas that are longer than 5 characters and not pure JSON structure
          return str.length > 5 && 
                 !str.match(/^[\[\]{}",\s]+$/) && 
                 str !== "```json" && 
                 str !== "```" &&
                 !(str.startsWith('"') && str.endsWith('"') && str.length < 10) // Only filter very short quoted strings
        })
      }
      
      console.log("Cleaned ideas count:", cleanedIdeas.length, "for platform:", event.platform)
      console.log("Cleaned ideas sample:", cleanedIdeas.slice(0, 2))
      
      // Update ideas directly in the database (we're already in a mutation)
      try {
        const session = await ctx.db
          .query("sessions")
          .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
          .first()
        
        if (!session) {
          console.error("ERROR: Session not found for idea_stream event!")
          throw new Error("Session not found")
        }
        
        // Create a completely new object to ensure Convex detects the change
        // Deep clone to ensure reactivity
        const currentIdeas = session.ideas ? JSON.parse(JSON.stringify(session.ideas)) : {}
        currentIdeas[event.platform] = cleanedIdeas
        
        // Use replace instead of patch to ensure full object update
        await ctx.db.patch(session._id, {
          ideas: currentIdeas,
          updatedAt: Date.now(),
        })
        
        console.log("Successfully updated ideas directly in DB for platform:", event.platform)
        console.log("Updated ideas object keys:", Object.keys(currentIdeas))
        console.log("Updated ideas for", event.platform, ":", currentIdeas[event.platform]?.length, "ideas")
        
        // Verify the update immediately
        const updatedSession = await ctx.db
          .query("sessions")
          .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
          .first()
        
        if (updatedSession) {
          const platformIdeas = updatedSession.ideas?.[event.platform] || []
          console.log("Verified: Session now has", platformIdeas.length, "ideas for platform", event.platform)
          console.log("All platforms in session:", Object.keys(updatedSession.ideas || {}))
        } else {
          console.error("ERROR: Session not found after update!")
        }
      } catch (error) {
        console.error("ERROR updating ideas for platform:", event.platform, "Error:", error)
        throw error
      }
    } else if (event.type === "complete") {
      console.log("Processing complete event for session:", sessionId)
      // Clean up all ideas in the complete event
      const cleanedIdeas: any = {}
      if (event.ideas) {
        for (const [platform, platformIdeas] of Object.entries(event.ideas)) {
          if (Array.isArray(platformIdeas)) {
            // Filter out JSON structure elements first
            const filtered = platformIdeas.filter((item: any) => {
              const str = String(item).trim()
              return str !== "```json" && str !== "```" && str !== "[" && str !== "]" && str.length > 0
            })
            
            // Then clean each idea
            cleanedIdeas[platform] = filtered.map((idea: any) => {
              if (typeof idea === 'string') {
                let cleaned = idea
                  .replace(/^```json\s*/i, '')
                  .replace(/^```\s*/, '')
                  .replace(/\s*```$/, '')
                  .replace(/^\[\s*/, '')
                  .replace(/\s*\]$/, '')
                  .trim()
                  // Remove leading/trailing quotes and commas
                  cleaned = cleaned.replace(/^["',]+/, '').replace(/["',]+$/, '')
                  // Remove escaped characters
                  cleaned = cleaned.replace(/\\"/g, '"').replace(/\\n/g, ' ')
                  // Remove trailing commas
                  cleaned = cleaned.replace(/,\s*$/, '')
                  return cleaned
              }
              return String(idea)
            }).filter((idea: string) => {
              const str = String(idea).trim()
              // Filter out empty strings and JSON structure elements
              return str.length > 10 && !str.match(/^[\[\]{}",\s]+$/) && !str.startsWith('"') && !str.endsWith('"')
            })
          }
        }
      }
      
      console.log("=== PROCESSING COMPLETE EVENT ===")
      console.log("Updating session to complete with cleaned ideas:", Object.keys(cleanedIdeas))
      
      // Get current session to check status
      const currentSession = await ctx.db
        .query("sessions")
        .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
        .first()
      
      console.log("Current session status before update:", currentSession?.status)
      
      if (!currentSession) {
        console.error("Session not found for complete event!")
        return
      }
      
      // Update session with complete status using mutation
      await ctx.runMutation(api.sessions.updateSession, {
        sessionId,
        ideas: cleanedIdeas,
        status: "complete",
      });
      
      // Verify the update
      const updatedSession = await ctx.db
        .query("sessions")
        .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
        .first()
      
      console.log("Session status after complete update:", updatedSession?.status)
      console.log("=== COMPLETE EVENT PROCESSED ===")
    }
  },
});

// Helper function to format partial research from trending topics
function formatPartialResearch(
  trendingTopics: Array<{
    topic: string;
    reason: string;
    url?: string;
    timestamp?: string;
    confidence?: string;
  }>,
  sources: string[]
): string {
  let research = `# Research Report (In Progress)\n\n`;
  research += `*Finding trends... ${trendingTopics.length} trend${trendingTopics.length !== 1 ? 's' : ''} discovered so far.*\n\n`;
  
  if (trendingTopics.length > 0) {
    research += `## Top Trends Discovered\n\n`;
    
    trendingTopics.forEach((topic, index) => {
      research += `### ${index + 1}. ${topic.topic}\n\n`;
      research += `**Why it matters**: ${topic.reason}\n\n`;
      
      if (topic.url) {
        research += `**Source**: [View source](${topic.url})\n\n`;
      }
      
      if (topic.timestamp) {
        research += `**Published**: ${new Date(topic.timestamp).toLocaleDateString()}\n\n`;
      }
      
      if (topic.confidence) {
        research += `**Confidence**: ${topic.confidence}\n\n`;
      }
      
      research += `---\n\n`;
    });
  }
  
  if (sources.length > 0) {
    research += `## Sources\n\n`;
    sources.forEach((source, index) => {
      research += `${index + 1}. [${source}](${source})\n`;
    });
  }
  
  return research;
}
