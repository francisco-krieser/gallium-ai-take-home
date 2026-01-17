import os
import json
from typing import Dict, Any, AsyncIterator, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from sse_starlette.sse import EventSourceResponse
import asyncio

from agent import MarketingCopyAgent, AgentState, pending_approvals

load_dotenv()

app = FastAPI(title="Marketing Copy Agent API")

# CORS middleware - must specify exact origins when using credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    query: str
    platforms: list[str] = ["LinkedIn", "X", "Instagram"]
    session_id: str
    mode: str = "deep"  # "deep" or "fast"


class ApprovalRequest(BaseModel):
    session_id: str
    action: str  # "approve", "refine", "restart"
    refinement: Optional[str] = None


@app.get("/")
async def root():
    return {"message": "Marketing Copy Agent API"}


@app.get("/test-approve")
async def test_approve():
    """Test endpoint to verify routing works"""
    return {"pending_approvals": list(pending_approvals.keys()), "count": len(pending_approvals)}


@app.post("/generate")
async def generate_ideas(request: GenerateRequest):
    """Trigger the agent and stream results"""
    agent = MarketingCopyAgent()
    
    async def event_generator():
        try:
            async for event in agent.run_stream(request.query, request.platforms, request.session_id, mode=request.mode):
                # Store approval data when research completes (fallback)
                if event.get("type") == "research_complete":
                    if request.session_id not in pending_approvals:
                        pending_approvals[request.session_id] = {
                            "research": event.get("research", ""),
                            "sources": event.get("sources", []),
                            "trending_topics": event.get("trending_topics", []),
                            "platforms": request.platforms,
                            "original_query": request.query,
                            "mode": request.mode,
                        }
                        print(f"Stored approval data from event for session_id: {request.session_id}")
                
                yield {
                    "event": "message",
                    "data": json.dumps(event)
                }
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }
    
    return EventSourceResponse(event_generator())


@app.post("/approve")
async def approve_research(request: ApprovalRequest):
    """Handle user approval/refinement decision"""
    print(f"=== APPROVE ENDPOINT CALLED ===")
    print(f"Approval request for session_id: {request.session_id}")
    print(f"Action: {request.action}")
    print(f"Available sessions in pending_approvals: {list(pending_approvals.keys())}")
    print(f"Pending approvals: {pending_approvals}")
    
    if request.session_id not in pending_approvals:
        print(f"ERROR: Session {request.session_id} not found in pending_approvals")
        raise HTTPException(status_code=404, detail=f"Session not found. Available: {list(pending_approvals.keys())}")
    
    print(f"Session found, proceeding with action: {request.action}")
    
    session_data = pending_approvals[request.session_id]
    
    if request.action == "approve":
        # Continue with idea generation
        agent = MarketingCopyAgent()
        async def event_generator():
            try:
                async for event in agent.continue_after_approval(
                    request.session_id,
                    session_data["research"],
                    session_data["platforms"]
                ):
                    yield {
                        "event": "message",
                        "data": json.dumps(event)
                    }
            except Exception as e:
                yield {
                    "event": "error",
                    "data": json.dumps({"error": str(e)})
                }
        return EventSourceResponse(event_generator())
    
    elif request.action == "refine":
        if not request.refinement:
            raise HTTPException(status_code=400, detail="Refinement text required")
        # Restart research with refinement
        agent = MarketingCopyAgent()
        async def event_generator():
            try:
                new_query = f"{session_data['original_query']}\n\nRefinement: {request.refinement}"
                # Preserve mode from original request if available, default to deep
                mode = session_data.get("mode", "deep")
                async for event in agent.run_stream(
                    new_query,
                    session_data["platforms"],
                    request.session_id,
                    is_refinement=True,
                    mode=mode
                ):
                    yield {
                        "event": "message",
                        "data": json.dumps(event)
                    }
            except Exception as e:
                yield {
                    "event": "error",
                    "data": json.dumps({"error": str(e)})
                }
        return EventSourceResponse(event_generator())
    
    elif request.action == "restart":
        # Restart with new query
        agent = MarketingCopyAgent()
        async def event_generator():
            try:
                # Preserve mode from original request if available, default to deep
                mode = session_data.get("mode", "deep")
                async for event in agent.run_stream(
                    request.refinement or session_data["original_query"],
                    session_data["platforms"],
                    request.session_id,
                    is_refinement=True,
                    mode=mode
                ):
                    yield {
                        "event": "message",
                        "data": json.dumps(event)
                    }
            except Exception as e:
                yield {
                    "event": "error",
                    "data": json.dumps({"error": str(e)})
                }
        return EventSourceResponse(event_generator())
    
    raise HTTPException(status_code=400, detail="Invalid action")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
