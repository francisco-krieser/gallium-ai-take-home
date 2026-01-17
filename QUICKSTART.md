# Quick Start Guide

## Prerequisites Check

- [ ] Node.js 18+ installed
- [ ] OpenAI API key
- [ ] Convex account (sign up at https://convex.dev)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
# From root directory
npm install
```

### 2. Configure Environment Variables

**Convex Backend** - Set environment variables using the Convex CLI:
```bash
cd packages/convex-backend
npx convex env set OPENAI_API_KEY sk-your-key-here
npx convex env set TAVILY_API_KEY your_tavily_key_here  # Optional
npx convex env set COMPOSIO_API_KEY your_composio_key_here  # Optional
npx convex env set COMPOSIO_USER_ID your_composio_user_id_here  # Optional
```

**Note**: These environment variables are stored securely in your Convex project. You can also manage them in the Convex dashboard at https://dashboard.convex.dev

**Next.js Frontend** (`packages/nextjs-frontend/.env.local`):
```
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

### 3. Initialize Convex

```bash
cd packages/convex-backend
npm install
npx convex dev
```

When prompted:
- Create a new project (or use existing)
- Copy the deployment URL (looks like `https://xxx.convex.cloud`)
- Use this URL in `NEXT_PUBLIC_CONVEX_URL` in the frontend `.env.local`

### 4. Start Services

**Terminal 1 - Convex:**
```bash
cd packages/convex-backend
npx convex dev
```

**Terminal 2 - Next.js:**
```bash
cd packages/nextjs-frontend
npm run dev
```

### 5. Open the App

Navigate to http://localhost:3000

## Testing the Flow

1. Enter a query like: "Generate marketing copy for a new AI productivity tool"
2. Select platforms (LinkedIn, X, Instagram)
3. Watch research stream in real-time
4. Review research findings
5. Click "Approve & Proceed" or request refinements
6. See ideas appear in the sidebar for each platform

## Troubleshooting

### Convex API Import Errors

If you see TypeScript errors about Convex API imports:
1. Make sure you've run `npx convex dev` in `packages/convex-backend`
2. The generated API types should be in `packages/convex-backend/convex/_generated/api.d.ts`
3. The frontend imports these types (with `@ts-ignore` for compatibility)

### Agent Not Responding

- Check that Convex is running: `npx convex dev`
- Verify `OPENAI_API_KEY` is set: `npx convex env ls` (should show OPENAI_API_KEY)
- If not set, run: `npx convex env set OPENAI_API_KEY your-key-here`
- Check Convex dashboard for errors: https://dashboard.convex.dev

### Real-time Updates Not Working

- Ensure Convex dev server is running
- Check browser console for errors
- Verify the Convex URL in frontend `.env.local` matches your deployment

## Architecture Notes

- **Agent Logic**: All agent logic runs in Convex actions
- **State Management**: Convex stores session state and messages
- **HITL**: Agent pauses at research completion, waits for approval
- **Real-time Updates**: Convex provides reactive updates to frontend via queries
