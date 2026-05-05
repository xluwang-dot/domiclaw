# CLAUDE.md — domiclaw AI 开发助手指令

## 项目定位

domiclaw 是一个面向中学生的 AI 学习助手，目标是培养自主学习能力。每位用户拥有一个专属的 AI 伙伴（不是老师），通过知识图谱、测验、间隔重复和主动提醒来辅助学习。系统已实现多用户支持，所有数据通过 `user_id` 严格隔离，同一用户从任何设备登录看到完全一致的对话历史和学习状态。

## 核心架构原则

### 用户与数据隔离
- **多用户支持已实现**：所有数据通过 `user_id` 隔离。
- **统一上下文**：同一用户无论从哪个设备登录，看到的对话历史、测验进度、复习状态都完全一致。`session_context` 表的主键是 `user_id`。
- **禁止多端同时登录**：登录时自动销毁旧 session（通过 `active_session_id` 字段），保证同时只有一个活跃客户端。
- **`chat_jid` 已降级并移除**：所有数据隔离基于 `user_id`，不再使用 `chat_jid` 作为隔离字段。所有数据库 `user_id` 列为 `NOT NULL`，所有查询函数强制要求 `userId: number` 参数，无回退逻辑。
- **Agent 独立**：每个用户拥有独立的 Agent 实例（消息驱动，无状态函数），通过 `userId` 获取个性化系统提示词（薄弱知识点、计划进度、待复习卡片）。

### 部署模式
- 典型部署是**单实例 Web 服务**（Node.js + SQLite），通过 `npm start` 直接运行。
- 容器化仅作为可选分发方式，必须保持简单：单容器、挂载数据库 volume、无多服务编排。
- **严禁**使用多容器实例来区分用户或群组，应用层已完成用户隔离。
- 不使用 Redis 或任何外部缓存服务。SQLite 启用 WAL 模式即可满足性能需求。

### 渠道发展路线
- **Web 唯一渠道**：系统仅保留 HTTP + SSE Web 频道，TUI 频道已彻底移除。
- **桌面版后续**：Web 稳定后，用原生外壳（如 Tauri）嵌入 Web 前端，增加系统通知、离线缓存等能力。桌面版不是独立容器或新后端，仅是一个外壳。
- 所有用户通过 Web 界面使用系统，所有交互（包括定时提醒通知）统一通过 Web 频道。

### 已清理的遗留痕迹
- **nanoclaw 容器模式**：`groups/` 目录、`src/group-folder.ts`、`Dockerfile`、`docker-compose.yml`、`.dockerignore` 已全部删除。
- **TUI 频道**：`src/channels/tui.ts` 已删除，`src/index.ts` 中无任何 TUI 启动逻辑，环境变量 `TUI_USER_ID` 已移除。
- **`chat_jid` 核心隔离**：所有业务表以 `user_id` 为隔离字段，无 `chat_jid` 回退逻辑。
- 任何新代码不得重新引入多实例隔离、`groups/` 概念、TUI 频道或 `chat_jid` 数据隔离。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js >= 20, TypeScript, Express |
| 数据库 | SQLite（better-sqlite3），启用 WAL 模式 |
| Web 前端 | Vue 3 CDN 单页应用（多 HTML 文件：login.html, app.html, admin.html） |
| 会话管理 | express-session + connect-sqlite3 |
| 用户认证 | bcryptjs 密码哈希，session cookie（httpOnly） |
| 模型调用 | OpenAI 兼容 API，支持 DeepSeek、Qwen、Anthropic 等 |
| 外部依赖 | 无 Redis、无外部缓存、无多容器编排 |

## 数据模型概览

### 用户与认证
- `users`：id, username, password_hash, role (`student`|`admin`), created_at, last_active, active_session_id

### 知识本体层（全局共享）
- `subjects`：学科
- `knowledge_points`：知识点，支持层级（parent_id）和依赖关系

### 题库层（双层）
- `questions`：题目，`user_id IS NULL` 为系统题库（全局共享），`user_id IS NOT NULL` 为用户私有题库

### 用户学习状态层（按 user_id 隔离）
- `quiz_sessions` / `quiz_answers`：测验记录，`weak_kp_ids` 字段存储 AI 归因的薄弱知识点
- `wrong_questions`：错题本，`root_kp_id` 记录根本知识点
- `review_schedules`：SM-2 间隔重复调度
- `study_plans` / `plan_tasks`：学习计划与任务
- `session_context`：统一对话上下文（主键 user_id）
- `messages`：对话消息
- `scheduled_tasks`：定时提醒任务
- `user_kp_mastery`：用户对每个知识点的掌握度（0~1，EWMA 更新）
- `user_kp_weakness`：按知识点聚合的弱点统计

## 核心联动机制

### 知识点掌握度（EWMA）
- `updateKpMastery(userId, kpId, correct)`：每次答题后调用
- 公式：`new = old + alpha * (target - old)`，alpha=0.2，target=1（正确）或 0（错误）
- 初始值 0.5，动态更新

### 错题聚合与归因
- 答题错误时自动更新 `user_kp_weakness`，按知识点聚合错误次数
- 可选 AI 归因工具 `analyze_wrong_answer`：分析学生答案，识别最可能薄弱的关联知识点子集
- 同一知识点的多道错题不产生重复复习卡片，保留代表性题目

### 复习决策双轨
- **题目级**：SM-2 间隔重复（1→3→7→14→30 天）
- **知识点级**：当 mastery < 0.6，自动触发专项复习（从题库抽取该知识点 2~3 道题）
- 掌握度 > 0.8 自动清除对应弱点记录

### 知识图谱可视化
- 节点颜色直接绑定 `user_kp_mastery` 值：红（<0.5）、黄（0.5-0.8）、绿（>0.8）、灰（无记录）
- 章节节点可展开/收缩，显示子知识点
- 点击知识点节点直接弹出测验窗口

## 前端架构

### 文件结构
- `web/login.html`：登录/注册页
- `web/app.html`：学生学习主界面（知识画布 + 聊天面板 + 测验弹窗）
- `web/admin.html`：管理后台（知识库、题库、用户管理）

### 画布系统（app.html）
- **架构**：DOM 节点层 + SVG 连线层 + CSS Transform 缩放/平移
- **绝不改为 Canvas**。当前混合方案是此场景的最优解
- 缩放：以鼠标为中心，`transform: translate() scale()`
- 连线：SVG `<path>` 贝塞尔曲线，带箭头标记
- 节点：绝对定位 `<div>`，支持 Vue 响应式、CSS 过渡、悬浮 tooltip

### 测验弹窗（QuizModal）
- 从知识点节点触发，居中弹窗 + 背景遮罩
- 抽题上限 5 题，支持“换一批”（exclude_ids 机制，题库耗尽后隐藏按钮）
- 提交后立即批改，每题提供“解析”按钮（先查缓存，无则 LLM 生成并缓存）
- 测验完成后刷新知识图谱节点颜色（掌握度更新）

### 聊天面板
- 左侧固定，SSE 流式输出，思考过程可折叠显示
- 支持本地命令（无 API 消耗）
- 测验创建可通过聊天命令或直接点击知识图谱节点

## 开发规范

### 数据库操作
- 所有业务表必须有 `user_id` 列（`NOT NULL`）并建立索引
- 所有查询函数签名必须包含 `userId: number` 参数（必填）
- 全局表（`subjects`, `knowledge_points`）不需要 `user_id`
- `questions` 表 `user_id` 可空：NULL=系统题库，非 NULL=用户私有题库
- 禁用 `chat_jid` 作为数据隔离字段

### API 设计
- 认证路由：`/api/auth/*`（无需认证：register, login；需认证：logout, me）
- 管理路由：`/api/admin/*`（需 `requireAuth` + `role === 'admin'`）
- 用户私有路由：`/api/my/*`（需 `requireAuth`）
- 通用路由：`/api/graph`, `/api/message`, `/api/stream`, `/api/quiz/*`, `/api/user/*`（需 `requireAuth`）
- 所有非认证 API 都需要 `requireAuth` 中间件
- API 响应统一为 JSON，错误格式：`{ error: string }`

### Agent 与工具
- 系统提示词构建时，通过 `userId` 获取用户薄弱知识点、掌握度概览、计划进度、待复习卡片，注入提示词
- 所有工具从 `ToolContext` 获取 `userId`，调用 DB 函数时必须传递
- 工具执行结果自动限定在当前用户数据范围
- 用户与 Agent 交互遵循“伙伴”风格：鼓励、引导，不排名、不威压
- Agent 可主动发起对话：学习开始时打招呼，学习过程中给予微鼓励

### 前端开发
- 保持 CDN 方案，不引入构建工具（除非后期迁移 Vite）
- 组件结构清晰，状态管理使用 Vue 3 Composition API
- 所有 API 请求通过 `fetch`，SSE 通过 `EventSource`
- 前端不直接操作数据库或文件系统

### 样式规范
- 暗色主题为主，支持亮色切换
- 知识点节点颜色动态绑定掌握度
- 聊天面板、测验弹窗、工具栏使用固定定位分层（z-index 管理）
- 节点 hover 效果、错题标记（红色边框）

## 禁止事项

- ❌ 不要重新引入 `groups/`、`group-folder.ts`、多容器隔离
- ❌ 不要重新引入 TUI 频道或 `chat_jid` 数据隔离
- ❌ 不要引入 Redis 或外部缓存服务
- ❌ 不要在工具或 Agent 中绕过 `user_id` 隔离
- ❌ 不要将画布改为 Canvas（保持 DOM + SVG + CSS Transform）
- ❌ 不要为不同用户启动多个应用实例
- ❌ 不要在 Web 频道中直接操作已移除的 TUI 逻辑

## 性能与优化
- 启用 WAL 模式提升并发读写
- 高频静态数据（如学科列表）可缓存在 Node.js 进程内存中，设置 TTL
- 避免过大的上下文窗口，使用 `MAX_CONTEXT_MESSAGES` 限制
- AI 生成解析后缓存到 `questions.explanation` 字段，避免重复调用 LLM
- 解析生成加入频率限制（每用户每分钟最多 3 次）

## 后续规划
1. 完善管理后台功能（知识库可视化编辑、题目去重检测、用户学习报告）
2. 学习功能深化（自适应学习路径、游戏化成就系统、语音交互）
3. Web 渠道稳定后，启动桌面版（Tauri 外壳，复用全部 Web 界面，增加系统通知和离线缓存）
4. 探索移动 PWA 或其他渠道（共享同一后端 API）
