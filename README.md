# Marketing Copy Agent - Monorepo

A monorepo containing:
- FastAPI service with LangGraph agent for marketing copy generation
- Convex backend with actions
- Next.js frontend with Convex integration

## Features

- **HITL (Human-in-the-Loop)**: System stops after research and waits for user approval
- **Streaming**: Real-time updates for research findings and idea generation
- **Platform-specific Ideas**: Sidebar showing ideas for each platform (LinkedIn, X, Instagram, etc.)
- **Transparent Steps**: Clear visibility into what the system is doing
- **Source Attribution**: Shows sources used in research
- **Trending Topics**: Displays trending topics and reasoning
- **Three-Step Research Workflow**:
  - **Step 1: Research Plan** - Automatically clarifies scope (time window, region, domain) and selects tools
  - **Step 2: Trend Retrieval** - Fetches trends from Tavily (web search) and Reddit (community discussions)
  - **Step 3: Research Report** - Synthesizes top 5-10 trends with summaries, links, timestamps, and confidence scores

## Structure

- `packages/fastapi-agent/` - FastAPI service with LangGraph agent
- `packages/convex-backend/` - Convex backend with actions and state management
- `packages/nextjs-frontend/` - Next.js frontend with streaming UI

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11 or 3.12 (Python 3.13 is too new and may have compatibility issues with some packages)
  - Use `python3 --version` to check
  - If you have Python 2 as default, use `python3` explicitly
  - If you have Python 3.13, consider using Python 3.12: `python3.12 --version`
- OpenAI API key
- Convex account (free tier works)

### 1. Install Root Dependencies

```bash
npm install
```

### 2. Set up FastAPI Agent

```bash
cd packages/fastapi-agent
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Upgrade pip first (helps with prebuilt wheels)
pip install --upgrade pip setuptools wheel

# Install dependencies
# Note: If you encounter tiktoken version conflicts, install tiktoken first:
pip install "tiktoken>=0.5.2,<0.6.0"
# Then install other dependencies
pip install -r requirements.txt
```

**Note**: If your system defaults to Python 2, use `python3` explicitly. You can verify your Python version with `python3 --version` (should be 3.10+).

**Troubleshooting**: 
- **Rust compiler errors**: First try `pip install --only-binary :all: -r requirements.txt` (forces prebuilt wheels). If that fails, upgrade pip or install Rust.
- **Python 3.13 compatibility**: If you see "Python 3.13 is newer than PyO3's maximum supported version", use Python 3.11 or 3.12 instead: `python3.12 -m venv .venv`
- **Tiktoken version conflict**: If you see conflicts between `tavily-python` and `langchain-openai` regarding tiktoken versions, try:
  ```bash
  # Install tiktoken first with compatible version
  pip install "tiktoken>=0.5.2,<0.6.0"
  # Then install other packages (may need to force reinstall tavily-python)
  pip install -r requirements.txt --upgrade
  ```
  If that doesn't work, you can install packages without strict dependency checking:
  ```bash
  pip install -r requirements.txt --no-deps
  pip install tiktoken langchain langchain-openai langgraph tavily-python composio-core
  ```

Create `.env` file:
```bash
OPENAI_API_KEY=your_openai_api_key_here
```

#### Optional: Set up Research Tools (Tavily & Reddit)

The agent uses **Tavily** (web search) and **Reddit** (community trends) to fetch trend candidates. The system will work in simulation mode if credentials aren't provided, but real data requires API keys.

**Tavily Setup:**
1. Sign up at [https://tavily.com](https://tavily.com)
2. Get your API key from the dashboard
3. Add to `.env`:
```bash
TAVILY_API_KEY=your_tavily_api_key_here
```

**Reddit Setup (via Composio MCP):**
1. Sign up at [https://composio.dev](https://composio.dev) and create an account
2. Go to your Composio dashboard → Settings → API Keys
3. Generate an API key and copy it
4. In Composio dashboard, connect your Reddit account:
   - Go to Integrations → Reddit
   - Click "Connect" and authorize the required permissions (read posts, search, etc.)
   - This will allow Composio's MCP server to access Reddit on your behalf
5. Note your **User ID** from the Composio dashboard (usually your email or account ID)
6. Add to `.env`:
```bash
COMPOSIO_API_KEY=your_composio_api_key_here
COMPOSIO_USER_ID=your_composio_user_id_here
```

**Note**: If these credentials are not provided, the agent will simulate trend data for development/testing purposes.

### 3. Set up Convex Backend

```bash
cd packages/convex-backend
npm install
npx convex dev
```

This will:
- Create a new Convex project (if first time)
- Generate API types
- Start the dev server

Create `.env` file (optional, defaults to localhost):
```bash
FASTAPI_URL=http://localhost:8000
```

Copy the Convex URL from the output and use it in the Next.js frontend.

### 4. Set up Next.js Frontend

```bash
cd packages/nextjs-frontend
npm install
```

Create `.env.local` file:
```bash
NEXT_PUBLIC_CONVEX_URL=your_convex_url_from_step_3
NEXT_PUBLIC_FASTAPI_URL=http://localhost:8000
```

## Running

### Option 1: Run Everything Separately

1. Start FastAPI agent:
```bash
cd packages/fastapi-agent
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

2. Start Convex (in a new terminal):
```bash
cd packages/convex-backend
npx convex dev
```

3. Start Next.js (in a new terminal):
```bash
cd packages/nextjs-frontend
npm run dev
```

### Option 2: Use Root Script

From root directory:
```bash
npm run dev
```

This starts FastAPI and Next.js concurrently. You'll still need to run Convex separately.

## Usage

1. Open http://localhost:3000 in your browser
2. Enter a marketing query (e.g., "Generate ideas for a SaaS product launch")
3. Select platforms (LinkedIn, X, Instagram, etc.)
4. Watch the research phase stream in real-time
5. Review research findings and approve, refine, or restart
6. See platform-specific ideas appear in the sidebar as they're generated

## Architecture

- **FastAPI**: Handles LangGraph agent execution, streaming via SSE
- **Convex**: Manages state (sessions, messages, ideas) and provides real-time updates
- **Next.js**: Frontend streams from FastAPI and subscribes to Convex for state updates

## Development Notes

- The frontend imports Convex API types from the backend package
- Streaming happens directly from FastAPI to the frontend
- Convex mutations update state as events stream in
- The agent uses LangGraph with conditional edges for HITL flow

## Python Version Notes

If your system defaults to Python 2:
- Always use `python3` explicitly instead of `python`
- The virtual environment will use Python 3 once created with `python3 -m venv`
- After activating the venv, `python` and `pip` commands will automatically use Python 3
