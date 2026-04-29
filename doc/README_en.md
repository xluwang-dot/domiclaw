# Domiclaw — AI Study Assistant

An educational AI agent that helps students study through quizzes, spaced repetition,
knowledge management, study plans, and proactive reminders. Runs locally with
SQLite storage, supports multiple LLM backends, and includes a web UI with an
interactive knowledge graph canvas.

---

## Features

### Core
- **Tool calling** — Agent executes database and file operations via 15+ tools
- **Multi-model** — DeepSeek, Qwen, Anthropic, OpenAI-compatible APIs
- **Multi-channel** — TUI terminal, Web UI (HTTP + SSE), extensible plugin system
- **Streaming** — Real-time token output with thinking/reasoning display
- **Conversation memory** — Sliding context window + session persistence
- **Command system** — `/help`, `/status`, `/review`, `/plan`, `/quiz`, `/wrong` (no API cost)
- **Reliability** — Exponential backoff retry, multi-model failover, rate limiting

### Study
- **Quiz system** — Create quizzes from stored questions, auto-grade answers
- **Knowledge base** — Subjects, knowledge points, exam papers with search
- **Wrong question tracking** — Automatic logging with SM-2 spaced repetition (1→3→7→14→30 day intervals)
- **Study plans** — Day-by-day plans with progress tracking and completion bars
- **Scheduled reminders** — Daily review check-ins, exam countdowns, plan nudges
- **Data import/export** — Bulk JSON import, wrong question export

### Web UI
- **Knowledge graph canvas** — Pan, zoom, clickable subject/knowledge nodes
- **Chat panel** — Real-time streaming with thinking display
- **Quiz panel** — Questions stacked top-to-bottom, submit inline

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
```

### 2. Install

```bash
npm install
```

### 3. Run

```bash
# Dev mode
npm run dev

# Production
npm run build && npm start
```

### 4. Use

**TUI (terminal):**

```
=== Domiclaw TUI ===
> Create a quiz with 5 questions about Mathematics
> Quiz started! Session ID: 1, 5 questions...
```

**Web UI:** Open `http://localhost:3456` — chat on the left, quiz panel center-right, knowledge graph canvas as background.

**Commands:** Type `/help` in chat for a list of local commands (no API cost).

---

## Project Structure

```
domiclaw/
├── src/
│   ├── index.ts              # Entry point, polling loop, scheduler
│   ├── agent.ts              # LLM API calls, streaming, tool-calling loop
│   ├── config.ts             # Configuration from .env
│   ├── db.ts                 # SQLite — 10+ tables, 40+ query functions
│   ├── router.ts             # XML message formatting
│   ├── commands.ts           # Local command handler (/help, /status, etc.)
│   ├── rate-limit.ts         # Token bucket rate limiter
│   ├── logger.ts             # Structured console logger
│   ├── types.ts              # Type definitions
│   ├── env.ts                # .env file parser
│   ├── group-folder.ts       # Group folder validation
│   ├── channels/
│   │   ├── index.ts          # Channel registry
│   │   ├── tui.ts            # Terminal UI channel
│   │   └── http.ts           # HTTP server + SSE + REST API
│   └── tools/
│       ├── index.ts          # Tool registry
│       ├── quiz.ts           # create_quiz, record_answer, export_wrong_questions
│       ├── knowledge.ts      # add_knowledge_point, search_knowledge, add_exam_paper, import_questions
│       ├── review.ts         # get_due_reviews, review_answer, get_study_stats
│       ├── study.ts          # generate_study_plan, get_study_plan, mark_task_done, get_study_progress
│       └── reminder.ts       # schedule_daily_review, cancel_reminder, list_reminders
├── web/
│   └── index.html            # Vue 3 CDN single-page app (canvas + chat + quiz)
├── groups/                   # Per-group working directories + CLAUDE.md prompts
├── store/                    # SQLite database
├── data/                     # Runtime data (IPC)
├── doc/                      # Documentation
└── package.json
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
| `STREAMING_ENABLED` | Enable streaming | `true` |
| `MAX_CONTEXT_MESSAGES` | Conversation context window | `20` |
| `MAX_MESSAGES_PER_PROMPT` | Max messages per API call | `10` |
| `MAX_RETRIES` | API retry count | `3` |
| `RETRY_BASE_DELAY` | Retry base delay (ms) | `1000` |
| `RATE_LIMIT_MAX` | Requests per window | `10` |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms) | `60000` |
| `POLL_INTERVAL` | Message poll interval (ms) | `2000` |
| `LOG_LEVEL` | Log level | `info` |

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
  → Check rate limit
  → Check if command (/help, /status, etc.) — respond locally
  → Load conversation context (last N messages)
  → Build system prompt (CLAUDE.md + session context + weak areas)
  → If scheduled check-in: add check-in instructions
  → Call LLM with tools (streaming on first iteration)
  → If tool calls: execute locally, send results back, repeat
  → Stream response to channel (thinking in dim, content in normal)
  → Update session context
```

### Spaced Repetition

```
Wrong answer → interval = 1 day
1st correct review → interval = 3 days
2nd correct review → interval = 7 days
3rd correct review → interval = 14 days
4th correct review → interval = 30 days
3+ consecutive correct → mastered
Wrong again → reset to 1 day
```

### Scheduler

```
daily    — runs at HH:MM each day (e.g. review reminder)
once     — runs once at ISO datetime
interval — runs every N minutes

On fire: agent gets [Scheduled Check-in] prompt, checks reviews + plan, messages student.
```

---

## Adding a Channel

Implement the `Channel` interface:

```typescript
import { Channel, NewMessage } from "../types.js";
import type { ChannelOpts } from "./index.js";

export function MyChannel(opts: ChannelOpts): Channel {
  return {
    name: "mychannel",
    connect: async () => { /* login */ },
    sendMessage: async (jid, text) => { /* send */ },
    sendChunk: async (jid, chunk) => { /* streaming chunk */ },
    isConnected: () => true,
    ownsJid: (jid) => jid.startsWith("my:"),
    disconnect: async () => { /* cleanup */ },
  };
}
```

Register in `src/channels/index.ts`:

```typescript
import { MyChannel } from "./mychannel.js";
registerChannel("mychannel", MyChannel);
```

---

## Requirements

- Node.js >= 20
- better-sqlite3 (requires native build tools: `build-essential` / `python3`)

## License

ISC
