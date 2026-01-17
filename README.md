# Marketing Copy Agent - Monorepo

A monorepo containing:
- Convex backend with agent logic for marketing copy generation
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

- `packages/convex-backend/` - Convex backend with agent logic, actions, and state management
- `packages/nextjs-frontend/` - Next.js frontend with real-time UI

## Setup

### Prerequisites

- Node.js 18+
- OpenAI API key
- Convex account (free tier works)

### 1. Install Root Dependencies

```bash
npm install
```

### 2. Set up Convex Backend

```bash
cd packages/convex-backend
npm install
npx convex dev
```

This will:
- Create a new Convex project (if first time)
- Generate API types
- Start the dev server

Set environment variables in Convex using the CLI:
```bash
cd packages/convex-backend
npx convex env set OPENAI_API_KEY your_openai_api_key_here
npx convex env set TAVILY_API_KEY your_tavily_api_key_here  # Optional
npx convex env set COMPOSIO_API_KEY your_composio_api_key_here  # Optional
npx convex env set COMPOSIO_USER_ID your_composio_user_id_here  # Optional
```

**Note**: Environment variables in Convex are set per deployment. For local development, they're set in your Convex project. You can also view and manage them in the Convex dashboard.

**Optional: Set up Research Tools (Tavily & Reddit)**

The agent uses **Tavily** (web search) and **Reddit** (community trends) to fetch trend candidates. The system will work in simulation mode if credentials aren't provided, but real data requires API keys.

**Tavily Setup:**
1. Sign up at [https://tavily.com](https://tavily.com)
2. Get your API key from the dashboard
3. Add to `.env.local`:
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
6. Add to `.env.local`:
```bash
COMPOSIO_API_KEY=your_composio_api_key_here
COMPOSIO_USER_ID=your_composio_user_id_here
```

**Note**: If these credentials are not provided, the agent will simulate trend data for development/testing purposes.

Copy the Convex URL from the output and use it in the Next.js frontend.

### 3. Set up Next.js Frontend

```bash
cd packages/nextjs-frontend
npm install
```

Create `.env.local` file:
```bash
NEXT_PUBLIC_CONVEX_URL=your_convex_url_from_step_2
```

## Running

1. Start Convex (in a terminal):
```bash
cd packages/convex-backend
npx convex dev
```

2. Start Next.js (in a new terminal):
```bash
cd packages/nextjs-frontend
npm run dev
```

## Usage

1. Open http://localhost:3000 in your browser
2. Enter a marketing query (e.g., "Generate ideas for a SaaS product launch")
3. Select platforms (LinkedIn, X, Instagram, etc.)
4. Watch the research phase stream in real-time
5. Review research findings and approve, refine, or restart
6. See platform-specific ideas appear in the sidebar as they're generated

## Architecture

- **Convex Backend**: Handles agent logic, state management (sessions, messages, ideas), and provides real-time updates
- **Next.js Frontend**: Frontend calls Convex actions and subscribes to Convex for reactive state updates

## Development Notes

- The frontend imports Convex API types from the backend package
- All agent logic runs in Convex actions
- Convex mutations update state as events are processed
- The agent implements a three-step workflow: research plan → trend retrieval → research report
- Real-time updates are provided through Convex's reactive queries
