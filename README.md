# Domiclaw — AI 学习助手

一个教育 AI 助手，通过测验、间隔重复、知识管理、学习计划和主动提醒帮助学生。
本地运行，SQLite 存储，支持多种大模型，包含交互式知识图谱画布的 Web 界面。

---

## 功能

### 核心
- **工具调用** — Agent 通过 15+ 工具执行数据库和文件操作
- **多模型** — 支持 DeepSeek、Qwen、Anthropic、OpenAI 兼容 API
- **多频道** — TUI 终端、Web 界面（HTTP + SSE），可扩展插件系统
- **流式输出** — 实时 token 输出，支持思考/推理过程展示
- **对话记忆** — 滑动上下文窗口 + 会话持久化
- **命令系统** — `/help`、`/status`、`/review`、`/plan`、`/quiz`、`/wrong`（本地执行，无 API 消耗）
- **可靠性** — 指数退避重试、多模型故障转移、令牌桶限流

### 学习
- **测验系统** — 从题库中创建测验，自动评分
- **知识库** — 学科、知识点、试卷管理，支持搜索
- **错题追踪** — 自动记录错题，SM-2 间隔重复（1→3→7→14→30 天间隔）
- **学习计划** — 按天制定计划，进度追踪和完成度进度条
- **定时提醒** — 每日复习检查、考试倒计时、计划提醒
- **数据导入导出** — 批量 JSON 导入，错题导出

### Web 界面
- **知识图谱画布** — 拖拽、缩放，可点击的学科/知识节点
- **聊天面板** — 实时流式输出，思考过程展示
- **测验面板** — 题目纵向排列，在线作答

---

## 快速开始

### 1. 配置

```bash
cp .env.example .env
```

编辑 `.env` 填入 API 密钥:

```bash
# 模型
MODEL_NAME=deepseek-chat
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-api-key

# 助手名称
ASSISTANT_NAME=Domiclaw

# Web 界面端口（可选，如 3456）
WEBCLIENT_PORT=3456
```

### 2. 安装

```bash
npm install
```

### 3. 运行

```bash
# 开发模式
npm run dev

# 生产模式
npm run build && npm start
```

### 4. 使用

**TUI（终端）:**

```
=== Domiclaw TUI ===
> 给我出 5 道数学题
> 测验已开始！会话 ID: 1, 共 5 题...
```

**Web 界面:** 打开 `http://localhost:3456` — 左侧聊天，中间测验面板，背景为知识图谱画布。

**命令:** 在聊天中输入 `/help` 查看本地命令列表（无 API 消耗）。

---

## 项目结构

```
domiclaw/
├── src/
│   ├── index.ts              # 入口，轮询循环，定时任务
│   ├── agent.ts              # LLM API 调用，流式输出，工具调用循环
│   ├── config.ts             # 配置（从 .env 加载）
│   ├── db.ts                 # SQLite — 10+ 表，40+ 查询函数
│   ├── router.ts             # XML 消息格式化
│   ├── commands.ts           # 本地命令处理（/help, /status 等）
│   ├── rate-limit.ts         # 令牌桶限流器
│   ├── logger.ts             # 结构化控制台日志
│   ├── types.ts              # 类型定义
│   ├── env.ts                # .env 文件解析
│   ├── group-folder.ts       # 群组文件夹验证
│   ├── channels/
│   │   ├── index.ts          # 频道注册表
│   │   ├── tui.ts            # 终端 UI 频道
│   │   └── http.ts           # HTTP 服务器 + SSE + REST API
│   └── tools/
│       ├── index.ts          # 工具注册表
│       ├── quiz.ts           # create_quiz, record_answer, export_wrong_questions
│       ├── knowledge.ts      # add_knowledge_point, search_knowledge, add_exam_paper, import_questions
│       ├── review.ts         # get_due_reviews, review_answer, get_study_stats
│       ├── study.ts          # generate_study_plan, get_study_plan, mark_task_done, get_study_progress
│       └── reminder.ts       # schedule_daily_review, cancel_reminder, list_reminders
├── web/
│   └── index.html            # Vue 3 CDN 单页应用（画布 + 聊天 + 测验）
├── groups/                   # 每个群组的工作目录 + CLAUDE.md 提示词
├── store/                    # SQLite 数据库
├── data/                     # 运行时数据（IPC）
├── doc/                      # 文档
└── package.json
```

---

## 配置参考

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ASSISTANT_NAME` | AI 名称和触发词 | `Domiclaw` |
| `MODEL_NAME` | 主模型 | `deepseek-chat` |
| `MODEL_BASE_URL` | API 地址 | `https://api.deepseek.com` |
| `MODEL_API_KEY` | API 密钥 | （必填） |
| `MODEL_NAME_FALLBACK` | 备用模型 | — |
| `MODEL_BASE_URL_FALLBACK` | 备用 API 地址 | — |
| `MODEL_API_KEY_FALLBACK` | 备用 API 密钥 | — |
| `WEBCLIENT_PORT` | Web 界面端口 | （禁用） |
| `STREAMING_ENABLED` | 启用流式输出 | `true` |
| `MAX_CONTEXT_MESSAGES` | 上下文窗口大小 | `20` |
| `MAX_MESSAGES_PER_PROMPT` | 单次最大消息数 | `10` |
| `MAX_RETRIES` | 重试次数 | `3` |
| `RETRY_BASE_DELAY` | 重试基础延迟（毫秒） | `1000` |
| `RATE_LIMIT_MAX` | 窗口内最大请求数 | `10` |
| `RATE_LIMIT_WINDOW` | 限流窗口（毫秒） | `60000` |
| `POLL_INTERVAL` | 消息轮询间隔（毫秒） | `2000` |
| `LOG_LEVEL` | 日志级别 | `info` |

## 支持的模型

| 提供商 | 模型 | Base URL |
|--------|------|----------|
| DeepSeek | `deepseek-chat`, `deepseek-reasoner` | `https://api.deepseek.com` |
| Qwen | `qwen-turbo`, `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Anthropic | `claude-sonnet-4-20250514` | `https://api.anthropic.com` |
| OpenAI | `gpt-4o`, `gpt-4.1` | `https://api.openai.com/v1` |

任何兼容 OpenAI 的 API 均可使用。

---

## 工作原理

### Agent 循环

```
用户消息
  → 检查限流
  → 检查是否为命令（/help, /status 等）— 本地响应
  → 加载对话上下文（最近 N 条消息）
  → 构建系统提示词（CLAUDE.md + 会话上下文 + 薄弱领域）
  → 如果为定时检查：附加检查指令
  → 调用 LLM（带工具定义，首轮流式输出）
  → 如有工具调用：本地执行，结果反馈给模型，重复
  → 流式输出到频道（思考过程灰色显示，内容正常显示）
  → 更新会话上下文
```

### 间隔重复

```
答错 → 间隔 = 1 天
第 1 次正确复习 → 间隔 = 3 天
第 2 次正确复习 → 间隔 = 7 天
第 3 次正确复习 → 间隔 = 14 天
第 4 次正确复习 → 间隔 = 30 天
连续正确 3 次以上 → 已掌握
再次答错 → 重置为 1 天
```

### 定时任务

```
daily    — 每天在指定时间运行（如复习提醒）
once     — 在指定 ISO 时间运行一次
interval — 每 N 分钟运行一次

触发时：agent 收到 [Scheduled Check-in] 提示，检查复习和计划，主动发送消息。
```

---

## 添加频道

实现 `Channel` 接口:

```typescript
import { Channel, NewMessage } from "../types.js";
import type { ChannelOpts } from "./index.js";

export function MyChannel(opts: ChannelOpts): Channel {
  return {
    name: "mychannel",
    connect: async () => { /* 登录 */ },
    sendMessage: async (jid, text) => { /* 发送 */ },
    sendChunk: async (jid, chunk) => { /* 流式输出块 */ },
    isConnected: () => true,
    ownsJid: (jid) => jid.startsWith("my:"),
    disconnect: async () => { /* 清理 */ },
  };
}
```

在 `src/channels/index.ts` 中注册:

```typescript
import { MyChannel } from "./mychannel.js";
registerChannel("mychannel", MyChannel);
```

---

## 环境要求

- Node.js >= 20
- better-sqlite3（需要原生编译工具：`build-essential` / `python3`）

## 许可证

ISC
