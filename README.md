# domiclaw — AI 学习助手

一个面向学生的 AI 学习伙伴，通过知识图谱、测验、间隔重复和主动提醒培养自主学习能力。
支持多用户，SQLite 存储，Web 界面，兼容多种大模型。

---

## 功能

### 核心
- **工具调用** — Agent 通过 17 个工具执行数据库和文件操作
- **多模型** — 支持 DeepSeek、Qwen、Anthropic、OpenAI 兼容 API
- **Web 界面** — 三页面架构（登录 / 学习主界面 / 管理后台），HTTP + SSE
- **多用户认证** — 注册 / 登录，bcrypt 密码哈希，session cookie，角色分离
- **流式输出** — 实时 token 输出，支持思考/推理过程展示
- **对话记忆** — 滑动上下文窗口 + 会话持久化
- **命令系统** — `/help`、`/status`、`/review`、`/plan`、`/quiz`、`/wrong`、`/subject`（本地执行，无 API 消耗）
- **可靠性** — 指数退避重试、多模型故障转移、令牌桶限流
- **结构化日志** — 5 阶段工作流追踪（入口→AQC→RAG→Agent→出口）

### 学习
- **测验系统** — 从题库创建测验，自动评分，AI 解析弱项知识点
- **知识库** — 学科、知识点（层级支持）、知识点间关联（前置/横向关系）
- **RAG 语义检索** — 向量嵌入（bge-base-zh-v1.5）语义匹配，环境变量切换（LIKE 降级）
- **错题追踪** — 自动记录错题，SM-2 间隔重复（1→3→7→14→30 天）
- **掌握度评估** — EWMA 算法追踪每个知识点的掌握度（0~1），知识图谱节点动态着色
- **AI 错题归因** — 分析错误答案，定位最可能薄弱的关联知识点
- **学习计划** — 按天制定计划，进度追踪和完成度进度条
- **定时提醒** — 每日复习检查、考试倒计时、计划提醒
- **数据导入导出** — 批量 JSON 导入题目，错题导出
- **自适应查询缓存** — 高频自然语言查询本地匹配，双层 LRU 缓存

### Web 界面
- **登录/注册页** — 用户认证入口
- **知识图谱画布** — 拖拽/缩放，DOM 节点 + SVG 连线，节点颜色绑定掌握度
- **聊天面板** — 实时流式输出，思考过程可折叠
- **测验弹窗** — 点击知识点节点弹窗抽题，支持换一批，提交后即时批改
- **管理后台** — 学科/知识点/题目 CRUD，用户管理，去重检测

---

## 快速开始

### 1. 配置

```bash
cp .env.example .env
```

编辑 `.env` 填入 API 密钥和管理员密码:

```bash
# 模型
MODEL_NAME=deepseek-chat
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-api-key

# 助手名称
ASSISTANT_NAME=Domiclaw

# Web 界面端口
WEBCLIENT_PORT=3456

# 管理员初始密码（首次启动自动创建 admin 用户）
ADMIN_PASSWORD=your-admin-password
```

### 2. 安装

```bash
npm install
```

### 3. 运行

```bash
# 开发模式
npm run dev

# 生产模式（启用 RAG 向量检索）
VECTOR_SEARCH_ENABLED=true npm run build && npm start
```

### 4. 使用

打开 `http://localhost:3456`，注册账号或使用 `admin` 登录管理后台。

在聊天中输入 `/help` 查看本地命令列表。

---

## 项目结构

```
domiclaw/
├── src/
│   ├── index.ts              # 入口，Web 启动，定时任务调度
│   ├── agent.ts              # 重新导出 src/agent/
│   ├── agent/                # Agent 三层架构（T044）
│   │   ├── index.ts          #   入口
│   │   ├── loop.ts           #   工具调用循环
│   │   ├── environment.ts    #   系统提示构建（RAG 注入 + 会话上下文）
│   │   └── model.ts          #   LLM API 调用（流式 / 非流式）
│   ├── auth.ts               # 用户认证（注册/登录/session管理）
│   ├── config.ts             # 配置（从 .env 加载）
│   ├── db.ts                 # SQLite — 15+ 表，50+ 查询函数
│   ├── query-router.ts       # 自适应查询缓存（AQC）
│   ├── sessionStore.ts       # 自定义 better-sqlite3 session 存储
│   ├── router.ts             # XML 消息格式化
│   ├── commands.ts           # 本地命令处理（7 个命令）
│   ├── rate-limit.ts         # 令牌桶限流器
│   ├── logger.ts             # 结构化控制台日志
│   ├── types.ts              # 类型定义
│   ├── env.ts                # .env 文件解析
│   ├── rag/                  # RAG 语义检索（T058）
│   │   ├── index.ts          #   入口：initRetriever, retrieveRelevant
│   │   ├── embeddings/       #   向量嵌入
│   │   │   └── embeddingService.ts
│   │   └── retrievers/       #   检索器
│   │       ├── base.ts       #     抽象接口
│   │       ├── ftsRetriever.ts #     LIKE 降级检索
│   │       └── vectorRetriever.ts # 向量语义检索
│   ├── channels/
│   │   └── http.ts           # Express + SSE + REST API + 静态文件
│   └── tools/
│       ├── index.ts          # 工具注册表
│       ├── quiz.ts           # create_quiz, record_answer, export_wrong_questions
│       ├── knowledge.ts      # add_knowledge_point, search_knowledge, import_questions
│       ├── review.ts         # get_due_reviews, review_answer, get_study_stats
│       ├── study.ts          # generate_study_plan, get_study_plan, mark_task_done, get_study_progress
│       ├── reminder.ts       # schedule_daily_review, cancel_reminder, list_reminders
│       └── analyze.ts        # analyze_wrong_answer（AI 错题归因）
├── web/
│   ├── login.html            # 登录/注册页
│   ├── app.html              # 学生学习主界面（画布 + 聊天 + 测验弹窗）
│   └── admin.html            # 管理后台（学科/知识点/题目/用户管理）
├── data/
│   └── agent/
│       └── AGENT.md          # Agent 角色定义（伙伴风格、交互指南）
├── scripts/
│   └── generateEmbeddings.ts # 批量生成知识库嵌入向量
├── store/                    # SQLite 数据库（运行时）
├── package.json
└── .env.example
```

---

## 配置参考

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ASSISTANT_NAME` | AI 名称 | `Domiclaw` |
| `MODEL_NAME` | 主模型 | `deepseek-chat` |
| `MODEL_BASE_URL` | API 地址 | `https://api.deepseek.com` |
| `MODEL_API_KEY` | API 密钥 | （必填） |
| `MODEL_NAME_FALLBACK` | 备用模型 | — |
| `MODEL_BASE_URL_FALLBACK` | 备用 API 地址 | — |
| `MODEL_API_KEY_FALLBACK` | 备用 API 密钥 | — |
| `WEBCLIENT_PORT` | Web 界面端口 | （禁用） |
| `SESSION_SECRET` | Session 加密密钥 | 自动生成 |
| `ADMIN_USERNAME` | 管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理员初始密码 | （必填） |
| `STREAMING_ENABLED` | 启用流式输出 | `true` |
| `THINKING_MODE` | 思考模式（thinking / thinking_max） | `thinking` |
| `MAX_CONTEXT_MESSAGES` | 上下文窗口大小 | `20` |
| `MAX_MESSAGES_PER_PROMPT` | 单次最大消息数 | `10` |
| `MAX_RETRIES` | 重试次数 | `3` |
| `RETRY_BASE_DELAY` | 重试基础延迟（ms） | `1000` |
| `RATE_LIMIT_MAX` | 窗口内最大请求数 | `10` |
| `RATE_LIMIT_WINDOW` | 限流窗口（ms） | `60000` |
| `POLL_INTERVAL` | 定时任务轮询间隔（ms） | `2000` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `VECTOR_SEARCH_ENABLED` | 启用向量语义检索 | `false`（= LIKE 检索） |
| `EMBEDDING_MODEL` | 嵌入模型名称 | `Xenova/bge-base-zh-v1.5` |
| `RAG_TOP_K` | 检索返回条数 | `5` |
| `HF_MIRROR` | HuggingFace 镜像 | — |

## RAG 配置

向量检索默认关闭（使用 LIKE 降级检索），开启后首次启动会下载模型（~103MB）：

- 模型：`Xenova/bge-base-zh-v1.5`（768 维）
- 首次使用需要生成知识库嵌入：`npx tsx scripts/generateEmbeddings.ts`
- 知识库增删改时自动同步嵌入

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
  → 鉴权（session cookie）
  → 限流检查（按用户）
  → 检查是否为命令（/help, /status 等）— 本地响应
  → AQC 自适应查询缓存（常见问题本地匹配，跳过 LLM）
  → 加载对话上下文（最近 N 条消息）
  → 构建系统提示词（AGENT.md 角色定义 + 会话上下文 + RAG 检索注入 + 薄弱知识点）
  → 如为定时检查：附加 Scheduled Check-in 前缀
  → 调用 LLM（带 17 个工具定义，首轮流式输出）
  → 如有工具调用：本地执行，结果反馈给模型，最多 10 次循环
  → 流式输出到 SSE（思考过程可折叠，内容正常显示）
  → 更新会话上下文和掌握度
```

### 自适应查询缓存（AQC）

```
每次查询先过 AQC：
  1. 缓存命中 → 直接返回缓存的 LLM 回复
  2. 缓存未命中 → 调用 LLM 做意图分类（无需调用工具的问题）
     - chat → 放行给 Agent
     - stats/wrong/review/quiz → 有对应工具路由
  3. 新回复写入缓存（LRU，上限 100 条，定期清理过期条目）
```

### RAG 语义检索

```
系统提示构建时，如果有用户输入：
  1. 用输入文本检索知识点（向量或 LIKE）
  2. 前 N 条知识点的标题+摘要注入到 [Retrieved Knowledge] 段
  3. Agent 直接使用这些知识回答，无需额外搜索
```

### 掌握度评估（EWMA）

```
每次答题后更新知识点掌握度：
  new_mastery = old_mastery + 0.2 × (score - old_mastery)

score = 1（正确）或 0（错误）
初始值 = 0.5
值域 [0, 1]
```

### 间隔重复（SM-2）

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

触发时：Agent 收到 [Scheduled Check-in] 提示，主动检查复习和计划，推送 SSE 通知。
```

---

## 环境要求

- Node.js >= 20
- better-sqlite3（需要原生编译工具：`build-essential` / `python3`）

## 许可证

MIC
