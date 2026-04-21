# Domiclaw

一个极简的 AI Agent，通过消息频道接收用户输入，调用模型 API 生成回复。

## 特性

- **极简设计** - 代码量少，易于理解和修改
- **多模型支持** - 支持 DeepSeek、Qwen、Anthropic 等 OpenAI 兼容 API
- **多频道支持** - TUI 控制台（内置）、QQ、Telegram 等
- **SQLite 存储** - 消息历史和群组配置持久化
- **触发词机制** - 可配置触发词，只有提到时才响应

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/你的用户名/domiclaw.git
cd domiclaw
```

### 2. 配置模型

编辑 `.env` 文件：

```bash
# 模型配置
MODEL_NAME=deepseek-chat
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-api-key

# 可选：修改 AI 名称
ASSISTANT_NAME=Domiclaw
```

支持的模型：

- DeepSeek: `deepseek-chat`
- Qwen: `qwen-turbo`
- Anthropic: `claude-sonnet-4-20250514`

### 3. 安装依赖

```bash
npm install
```

### 4. 运行

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm run start
```

### 5. 使用

运行后，在控制台输入消息即可与 AI 对话：

```
=== Domiclaw TUI ===
输入消息发送给 AI Agent。
输入 "exit" 退出。

你好
> Hello! How can I help you today?
```

## 项目结构

```
domiclaw/
├── src/
│   ├── index.ts      # 主入口
│   ├── agent.ts      # 模型 API 调用
│   ├── config.ts    # 配置
│   ├── db.ts        # SQLite 数据库
│   ├── router.ts    # 消息路由
│   ├── logger.ts    # 日志
│   ├── types.ts     # 类型定义
│   ├── channels/    # 频道模块
│   │   ├── index.ts
│   │   ├── registry.ts
│   │   └── tui.ts
│   └── ...
├── groups/           # 群组工作目录
├── store/           # 数据库
├── data/            # 运行时数据
├── .env             # 配置文件
└── package.json
```

## 配置说明

| 变量             | 说明             | 默认值                     |
| ---------------- | ---------------- | -------------------------- |
| `ASSISTANT_NAME` | AI 名称          | `Domiclaw`                 |
| `MODEL_NAME`     | 模型名称         | `deepseek-chat`            |
| `MODEL_BASE_URL` | API 地址         | `https://api.deepseek.com` |
| `MODEL_API_KEY`  | API 密钥         | (必填)                     |
| `POLL_INTERVAL`  | 消息轮询间隔(ms) | `2000`                     |

## 添加新频道

参考 `channels/tui.ts` 实现 Channel 接口：

```typescript
import { Channel, NewMessage } from "../types.js";
import { ChannelOpts } from "./registry.js";

export function MyChannel(opts: ChannelOpts): Channel {
  return {
    name: "mychannel",
    connect: async () => {
      /* 登录/连接 */
    },
    sendMessage: async (jid, text) => {
      /* 发送消息 */
    },
    isConnected: () => true,
    ownsJid: (jid) => jid.startsWith("my:"),
    disconnect: async () => {
      /* 断开连接 */
    },
  };
}
```

然后在 `channels/index.ts` 注册：

```typescript
import { registerChannel } from "./registry.js";
import { MyChannel } from "./mychannel.js";

registerChannel("mychannel", MyChannel);
```

## 依赖

- Node.js >= 20
- better-sqlite3

## 许可证

MIT
