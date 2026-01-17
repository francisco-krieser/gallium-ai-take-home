# Quick Start Guide

## Prerequisites Check

- [ ] Node.js 18+ installed
- [ ] Python 3.11 or 3.12 installed (check with `python3 --version`)
  - **Important**: Python 3.13 is too new and may cause compatibility issues
  - If you have Python 3.13, use Python 3.12: `python3.12 --version`
  - If you have Python 2 as default, you'll need to use `python3` explicitly
- [ ] OpenAI API key
- [ ] Convex account (sign up at https://convex.dev)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
# From root directory
npm install

# Install Python dependencies
cd packages/fastapi-agent
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Upgrade pip first (important for prebuilt wheels)
pip install --upgrade pip setuptools wheel

# Install dependencies
pip install -r requirements.txt
```

**Important**: 
- If your system defaults to Python 2, always use `python3` instead of `python`. Verify with:
  ```bash
  python3 --version  # Should show Python 3.10 or higher
  ```
- If you get Rust compiler errors, see the "Rust Compiler Error" section in Troubleshooting below
```

### 2. Configure Environment Variables

**FastAPI Agent** (`packages/fastapi-agent/.env`):
```
OPENAI_API_KEY=sk-your-key-here
```

**Convex Backend** (`packages/convex-backend/.env` - optional):
```
FASTAPI_URL=http://localhost:8000
```

**Next.js Frontend** (`packages/nextjs-frontend/.env.local`):
```
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
NEXT_PUBLIC_FASTAPI_URL=http://localhost:8000
```

### 3. Initialize Convex

```bash
cd packages/convex-backend
npx convex dev
```

When prompted:
- Create a new project (or use existing)
- Copy the deployment URL (looks like `https://xxx.convex.cloud`)
- Use this URL in `NEXT_PUBLIC_CONVEX_URL` in the frontend `.env.local`

### 4. Start Services

**Terminal 1 - FastAPI:**
```bash
cd packages/fastapi-agent
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Terminal 2 - Convex:**
```bash
cd packages/convex-backend
npx convex dev
```

**Terminal 3 - Next.js:**
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

### FastAPI Not Connecting

- Check that FastAPI is running on port 8000
- Verify `NEXT_PUBLIC_FASTAPI_URL` in frontend `.env.local`
- Check CORS settings in `packages/fastapi-agent/main.py`

### Streaming Not Working

- Ensure FastAPI is using SSE (Server-Sent Events)
- Check browser console for errors
- Verify the EventSourceResponse is working in FastAPI

### Python Version Issues

If you get errors about Python version:
- Make sure you're using Python 3.10+: `python3 --version`
- Always use `python3` instead of `python` if your system defaults to Python 2
- When creating the virtual environment, use: `python3 -m venv .venv`
- After activating the venv, `python` and `pip` should point to Python 3 automatically

### Rust Compiler Error (pydantic-core, tiktoken)

If you see errors about missing Rust compiler when installing dependencies:

**Solution 1: Force prebuilt wheels (Recommended)**
```bash
# Make sure pip is up to date
pip install --upgrade pip

# Install with --only-binary flag to use prebuilt wheels
pip install --only-binary :all: -r requirements.txt
```

**Solution 2: Upgrade pip and try again**
```bash
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

**Solution 3: Install Rust (if above doesn't work)**
```bash
# On macOS with Homebrew
brew install rust

# Or using rustup (recommended)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Then retry installation
pip install -r requirements.txt
```

**Solution 4: Use alternative package versions**
If the above don't work, you can try installing packages individually:
```bash
pip install --upgrade pip
pip install fastapi uvicorn[standard] python-dotenv sse-starlette httpx
pip install langchain langchain-openai langgraph
pip install pydantic --upgrade
```

### Python 3.13 Compatibility Issue

If you see an error like "Python interpreter version (3.13) is newer than PyO3's maximum supported version (3.12)":

**Solution 1: Use Python 3.11 or 3.12 (Recommended)**
Python 3.13 is very new and some packages (like `tiktoken`) don't have full support yet. Use Python 3.11 or 3.12 instead:

```bash
# Check available Python versions
python3.12 --version  # or python3.11 --version

# Create venv with specific Python version
python3.12 -m venv .venv  # or python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

**Solution 2: Set compatibility flag (if you must use Python 3.13)**
```bash
export PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1
pip install -r requirements.txt
```

**Note**: Python 3.11 or 3.12 is recommended for best compatibility with all dependencies.

## Architecture Notes

- **Streaming**: Frontend streams directly from FastAPI via SSE
- **State Management**: Convex stores session state and messages
- **HITL**: Agent pauses at research completion, waits for approval
- **Real-time Updates**: Convex provides reactive updates to frontend
