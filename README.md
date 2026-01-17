# Marketing Copy Agent

AI-powered marketing copy generation with human-in-the-loop approval.

## Live Deployment

The application is deployed and available at:

**🌐 [https://gallium-ai-take-home-nextjs-fronten.vercel.app/](https://gallium-ai-take-home-nextjs-fronten.vercel.app/)**

- **Frontend**: Deployed on [Vercel](https://vercel.com)
- **Backend**: Deployed on [Convex](https://convex.dev)

## Local Development

### Prerequisites

- Node.js 18+
- OpenAI API key
- Convex account (free tier works)

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up Convex backend:**
   ```bash
   cd packages/convex-backend
   npm install
   npx convex dev
   ```
   
   Set environment variables:
   ```bash
   npx convex env set OPENAI_API_KEY your_openai_api_key_here
   npx convex env set TAVILY_API_KEY your_tavily_api_key_here
   ```
   
   Copy the Convex URL from the output.

3. **Set up Next.js frontend:**
   ```bash
   cd packages/nextjs-frontend
   npm install
   ```
   
   Create `.env.local`:
   ```bash
   NEXT_PUBLIC_CONVEX_URL=your_convex_url_from_step_2
   ```

### Running

1. Start Convex (terminal 1):
   ```bash
   cd packages/convex-backend
   npx convex dev
   ```

2. Start Next.js (terminal 2):
   ```bash
   cd packages/nextjs-frontend
   npm run dev
   ```

3. Open http://localhost:3000

## Structure

- `packages/convex-backend/` - Convex backend with agent logic
- `packages/nextjs-frontend/` - Next.js frontend with real-time UI
