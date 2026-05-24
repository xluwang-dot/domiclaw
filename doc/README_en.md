# Domiclaw — AI Study Assistant

An educational AI agent that helps students study through knowledge graphs, quizzes, spaced repetition,
study plans, a task engine, and proactive reminders. Runs locally with
SQLite storage, supports multiple LLM backends, and includes a web UI with an
interactive knowledge graph canvas.

---

## Features

### Core
- **Tool calling** — Agent executes database and file operations via 26 tools
- **Multi-model** — DeepSeek, Qwen, Anthropic, OpenAI-compatible APIs with failover
- **Web UI** — Three pages (Login / Study Main / Admin), HTTP + SSE
- **Auth** — Register/login, bcrypt password hashing, session cookies, role separation (user/admin)
- **Streaming** — Real-time token output with collapsible thinking/reasoning display
- **Conversation memory** — Configurable sliding context window + session persistence + auto-summarization
- **Command system** — `/help`, `/status`, `/review`, `/plan`, `/quiz`, `/wrong` (no API cost)
- **Reliability** — Exponential backoff retry, model failover, token bucket rate limiting
- **Structured logging** — 5-stage workflow tracking (entry→AQC→RAG→Agent→exit)

### Study
- **Quiz system** — Create quizzes from question bank, auto-grade, AI weak-point analysis
- **Knowledge base** — Subjects, knowledge points (multi-level tree), cross-KP relations (prerequisites/associations), alias search
- **RAG semantic search** — Vector embeddings (bge-base-zh-v1.5), auto-fallback to FTS/LIKE
- **Wrong question tracking** — Auto-logging with SM-2 spaced repetition (1→3→7→14→30 day intervals)
- **Mastery evaluation** — EWMA algorithm per KP (0~1), dynamic coloring on knowledge graph
- **AI wrong-answer attribution** — Pinpoints the most likely weak KPs from wrong answers
- **Study plan (Plan 1)** — AI assessment → chapter-by-chapter plan → nested quizzes → auto-advance
- **Scheduled reminders** — Daily review check-ins, exam countdowns, plan nudges
- **Bulk import/export** — JSON/CSV import for questions and KPs, wrong-question export

### Architecture
- **AQC (Adaptive Query Cache)** — Local natural-language pattern matching, dual LRU cache with periodic cleanup
- **`__CARD__` command channel** — Unified canvas operations (KP cards, quiz creation, toolbar), bypasses LLM and cache
- **TaskEngine** — Task mode management, phase tracking, task guards
- **Persistent SSE** — System event push (quiz popup, mode changes, progress), auto-reconnect

### Web UI
- **Login/Register** — Auth entry point
- **Knowledge graph canvas** — Pan/zoom/focus, DOM nodes + SVG edges, top-left layout, zoom-consistent, mastery-based node coloring
- **Chat panel** — Real-time streaming, LaTeX/KaTeX rendering, Markdown, collapsible thinking
- **Quiz panel** — Triggered via KP card click or Agent command, batch submit, instant grading with correct/wrong markers
- **Admin panel** — Subject/KP/Question CRUD, user management, duplicate detection, data import
- **Bottom toolbar** — Plan 1 progress, weakness review, wrong-question test, default layout, settings

---

## Quick Start

### 1. Configure

```bash
cp .env.example .env
```

Edit `.env` with your API key:

```bash
# Model
MODEL_NAME=deepseek-chat
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-api-key

# Assistant name
ASSISTANT_NAME=Domiclaw

# Web UI port (optional, e.g. 3456)
WEBCLIENT_PORT=3456

# Admin password (auto-creates admin user on first start)
ADMIN_PASSWORD=your-admin-password
```

### 2. Install

```bash
npm install
```

### 3. Run

```bash
# Dev mode (tsx hot-reload)
npm run dev

# Production mode
VECTOR_SEARCH_ENABLED=true npm run build && npm start
```

### 4. Use

Open `http://localhost:3456`, register an account or login as `admin`.

Type `/help` in chat for local commands (no API cost).

---

## Project Structure

```
domiclaw/
├── src/
│   ├── index.ts              # Entry: init DB + start Web server + scheduler
│   ├── db.ts                 # SQLite — 14+ tables, 60+ query functions
│   ├── agent.ts              # Re-export from src/agent/
│   ├── agent/
│   │   ├── index.ts          #   Entry
│   │   ├── loop.ts           #   Tool-calling loop (guards, phase callbacks)
│   │   ├── environment.ts    #   System prompt (RAG + context + hard constraints)
│   │   └── model.ts          #   LLM API calls (streaming / non-streaming)
│   ├── task/
│   │   └── taskEngine.ts     #   Task stack (inference, guards, phase tracking)
│   ├── query-router.ts       #   AQC layer + __CARD__ command interception
│   ├── auth.ts               #   User auth (register/login/session)
│   ├── config.ts             #   Configuration from .env
│   ├── sessionStore.ts       #   Custom better-sqlite3 session store
│   ├── sseBus.ts             #   SSE event bus (system events + streaming)
│   ├── commands.ts           #   Local command handler (/help, /status, etc.)
│   ├── rate-limit.ts         #   Token bucket rate limiter
│   ├── logger.ts             #   Structured console logger
│   ├── types.ts              #   Type definitions
│   ├── env.ts                #   .env file parser
│   ├── router.ts             #   XML message formatting
│   ├── rag/                  #   RAG semantic search
│   │   ├── index.ts          #     Entry: initRetriever, retrieveRelevant
│   │   ├── embeddings/
│   │   │   └── embeddingService.ts
│   │   └── retrievers/
│   │       ├── base.ts       #     Abstract interface
│   │       ├── ftsRetriever.ts #    FTS/LIKE fallback
│   │       └── vectorRetriever.ts # Vector semantic search
│   ├── channels/
│   │   └── http.ts           #   Express + SSE + REST API + static files
│   └── tools/
│       ├── index.ts          #   Tool registry (registerTool, getTool)
│       ├── utils.ts          #   Shared utilities (checkAnswer, formatOptions, etc.)
│       ├── quiz.ts           #   create_quiz, get_quiz_session, record_answer, export_wrong_questions
│       ├── knowledge.ts      #   add_knowledge_point, search_knowledge, import_questions
│       ├── review.ts         #   get_due_reviews, review_answer, get_study_stats
│       ├── study.ts          #   generate_study_plan, get_study_plan, mark_task_done, get_study_progress, start_self_eval, submit_self_assessment
│       ├── reminder.ts       #   schedule_daily_review, cancel_reminder, list_reminders
│       └── analyze.ts        #   analyze_wrong_answer (AI wrong-answer analysis)
├── web/
│   ├── login.html            # Login/Register page
│   ├── app.html              # Main study interface (canvas + chat + quiz panel)
│   ├── admin.html            # Admin panel (subjects/KPs/questions/users)
│   ├── app.css               # Main UI styles
│   ├── canvas.js             # Knowledge graph canvas module
│   ├── api.js                # HTTP API wrapper
│   ├── markdown.js           # Markdown/LaTeX renderer
│   └── images/               # Static images
├── data/
│   └── agent/
│       └── AGENT.md          # Agent role definition
├── scripts/
│   └── generateEmbeddings.ts # Batch generate KP embeddings
├── store/                    # SQLite database (runtime)
├── package.json
└── .env.example
```

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `ASSISTANT_NAME` | AI name and trigger word | `Domiclaw` |
| `MODEL_NAME` | Primary model | `deepseek-chat` |
| `MODEL_BASE_URL` | API base URL | `https://api.deepseek.com` |
| `MODEL_API_KEY` | API key | (required) |
| `MODEL_NAME_FALLBACK` | Fallback model | — |
| `MODEL_BASE_URL_FALLBACK` | Fallback API URL | — |
| `MODEL_API_KEY_FALLBACK` | Fallback API key | — |
| `WEBCLIENT_PORT` | Web UI port | (disabled) |
| `SESSION_SECRET` | Session encryption secret | auto-generated |
| `ADMIN_USERNAME` | Admin username | `admin` |
| `ADMIN_PASSWORD` | Admin password | (required) |
| `STREAMING_ENABLED` | Enable streaming | `true` |
| `THINKING_MODE` | Thinking mode (thinking / thinking_max) | `thinking` |
| `MAX_CONTEXT_MESSAGES` | Conversation context window | `30` |
| `MAX_MESSAGES_PER_PROMPT` | Max messages per API call | `10` |
| `MAX_RETRIES` | API retry count | `3` |
| `RETRY_BASE_DELAY` | Retry base delay (ms) | `1000` |
| `RATE_LIMIT_MAX` | Requests per window | `10` |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms) | `60000` |
| `VECTOR_SEARCH_ENABLED` | Enable vector search | `false` (uses FTS) |
| `EMBEDDING_MODEL` | Embedding model | `Xenova/bge-base-zh-v1.5` |
| `RAG_TOP_K` | RAG result count | `3` |
| `HF_MIRROR` | HuggingFace mirror | — |
| `VISION_MODEL_ENABLED` | Enable vision model | `false` |
| `VISION_MODEL_NAME` | Vision model name | `MiMo-V2.5` |

## Supported Models

| Provider | Model | Base URL |
|----------|-------|----------|
| DeepSeek | `deepseek-chat`, `deepseek-reasoner` | `https://api.deepseek.com` |
| Qwen | `qwen-turbo`, `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Anthropic | `claude-sonnet-4-20250514` | `https://api.anthropic.com` |
| OpenAI | `gpt-4o`, `gpt-4.1` | `https://api.openai.com/v1` |

Any OpenAI-compatible API works.

---

## How It Works

### Agent Loop

```
User message
  → Auth (session cookie)
  → Rate limit check
  → Local command check (/help, /status, etc.) — respond locally
  → __CARD__ interception (canvas ops execute tools directly, skip LLM + cache)
  → AQC adaptive cache (common questions matched locally, skip LLM)
  → Load conversation context (last N messages)
  → Build system prompt (AGENT.md + RAG injection + session context + task stack + hard rules)
  → If scheduled check-in: prepend check-in instructions
  → Call LLM with 26 tool definitions (streaming on first iteration)
  → If tool calls: execute locally (task guards), feed back to LLM, up to 10 loops
  → Stream response via SSE (thinking collapsible, content normal)
  → Update session context + mastery
```

### Adaptive Query Cache (AQC)

```
Each query goes through AQC:
  1. __CARD__: prefix → intercept directly, execute tool, return
  2. Cache hit → return cached LLM response
  3. Cache miss → LLM intent classification (questions that don't need tool calling)
     - chat → pass through to Agent
     - stats/wrong/review/quiz → has tool route
  4. New response written to cache (LRU, 100 per user / 500 system, periodic cleanup)
```

### Spaced Repetition (SM-2)

```
Wrong answer → interval = 1 day
1st correct review → interval = 3 days
2nd correct review → interval = 7 days
3rd correct review → interval = 14 days
4th correct review → interval = 30 days
3+ consecutive correct → mastered
Wrong again → reset to 1 day
```

### Task Engine

```
Task types:
  quiz       — Quiz task (guarded, no parallel quizzes)
  self_eval  — Self-assessment (supports nested quiz subtasks)
  review     — Review task

Lifecycle:
  Start → Running (phase: before / during / after) → End
  Guard: same-type tasks rejected on conflict
  Nesting: self_eval can nest quiz subtasks
```

### Scheduler

```
daily    — runs at HH:MM each day (e.g. review reminder)
once     — runs once at ISO datetime
interval — runs every N minutes

On fire: agent gets [Scheduled Check-in] prompt, checks reviews + plan, messages student.
```

---

## Requirements

- Node.js >= 20
- better-sqlite3 (requires native build tools: `build-essential` / `python3`)

## License

ISC
