# Domiclaw

A minimal AI agent that receives user input through message channels and calls model APIs to generate replies.

## Features

- **Minimal design** — small codebase, easy to understand and modify
- **Multi-model** — supports DeepSeek, Qwen, Anthropic, and any OpenAI-compatible API
- **Multi-channel** — TUI console (built-in), extensible for QQ, Telegram, etc.
- **SQLite storage** — message history and group config persisted locally
- **Trigger word** — configurable trigger, only responds when mentioned (except main group)

## Quick Start

### 1. Configure

Copy `.env.example` to `.env` and fill in your API key:

```bash
# Model config
MODEL_NAME=deepseek-chat
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-api-key

# Optional: change AI name
ASSISTANT_NAME=Domiclaw
```

Supported models:

- DeepSeek: `deepseek-chat` → `https://api.deepseek.com`
- Qwen: `qwen-turbo` → `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Anthropic: `claude-sonnet-4-20250514` → `https://api.anthropic.com`

### 2. Install

```bash
npm install
```

### 3. Run

```bash
# Dev mode
npm run dev

# Production
npm run build
npm start
```

### 4. Chat

Run and type messages in the console:

```
=== Domiclaw TUI ===
Hello
> Hi! How can I help you?
```

## Project Structure

```
domiclaw/
├── src/
│   ├── index.ts          # Entry point, polling loop
│   ├── agent.ts          # Model API calls
│   ├── config.ts         # Configuration from .env
│   ├── db.ts             # SQLite database layer
│   ├── router.ts         # Message formatting and routing
│   ├── logger.ts         # Structured console logger
│   ├── types.ts          # Type definitions
│   ├── env.ts            # .env file parser
│   ├── group-folder.ts   # Group folder validation
│   └── channels/
│       ├── index.ts      # Channel registry + TUI registration
│       └── tui.ts        # Terminal UI channel
├── groups/               # Per-group working directories
├── store/                # SQLite database
├── data/                 # Runtime data
├── .env                  # Local config (not committed)
├── .env.example          # Config template
└── package.json
```

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `ASSISTANT_NAME` | AI name and trigger word base | `Domiclaw` |
| `MODEL_NAME` | Model identifier | `deepseek-chat` |
| `MODEL_BASE_URL` | API base URL | `https://api.deepseek.com` |
| `MODEL_API_KEY` | API key | (required) |
| `POLL_INTERVAL` | Message poll interval (ms) | `2000` |
| `MAX_MESSAGES_PER_PROMPT` | Max messages per API call | `10` |

## Adding a Channel

Implement the `Channel` interface from `types.ts`:

```typescript
import { Channel, NewMessage } from "../types.js";
import { ChannelOpts } from "./index.js";

export function MyChannel(opts: ChannelOpts): Channel {
  return {
    name: "mychannel",
    connect: async () => { /* login / connect */ },
    sendMessage: async (jid, text) => { /* send message */ },
    isConnected: () => true,
    ownsJid: (jid) => jid.startsWith("my:"),
    disconnect: async () => { /* disconnect */ },
  };
}
```

Then register it in `channels/index.ts`:

```typescript
import { registerChannel } from "./index.js";
import { MyChannel } from "./mychannel.js";

registerChannel("mychannel", MyChannel);
```

## Requirements

- Node.js >= 20
- better-sqlite3

## License

ISC
