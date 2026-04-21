# Domiclaw - AI Agent Project

## 项目概述

Domiclaw 是一个极简的 AI Agent，通过消息频道接收用户输入，调用模型 API 生成回复。

## 技术栈

- **运行时**: Node.js >= 20
- **语言**: TypeScript
- **数据库**: SQLite (better-sqlite3)
- **模型**: OpenAI 兼容 API (DeepSeek, Qwen, Anthropic)

## 核心模块

### src/index.ts

主入口，负责：

- 初始化数据库
- 加载已注册群组
- 连接频道
- 消息轮询循环

### src/agent.ts

模型 API 调用，使用 fetch 调用 `{MODEL_BASE_URL}/chat/completions`

### src/config.ts

配置模块，从 `.env` 读取：

- MODEL_NAME: 模型名称
- MODEL_BASE_URL: API 地址
- MODEL_API_KEY: API 密钥
- ASSISTANT_NAME: AI 名称

### src/db.ts

SQLite 数据库操作：

- messages 表：消息历史
- chats 表：聊天元数据
- registered_groups 表：已注册群组
- router_state 表：路由状态

### src/channels/

频道模块，实现 Channel 接口：

- tui.ts: TUI 控制台频道
- registry.ts: 频道注册

## 运行命令

```bash
# 开发
npm run dev

# 构建
npm run build

# 生产运行
npm run start
```

## 添加频道

1. 在 `channels/` 创建新文件，实现 Channel 接口
2. 在 `channels/index.ts` 使用 `registerChannel` 注册

## 配置模型

修改 `.env`：

```bash
# DeepSeek
MODEL_NAME=deepseek-chat
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-key

# Qwen
MODEL_NAME=qwen-turbo
MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_API_KEY=your-key

# Anthropic
MODEL_NAME=claude-sonnet-4-20250514
MODEL_BASE_URL=https://api.anthropic.com
MODEL_API_KEY=sk-ant-your-key
```
