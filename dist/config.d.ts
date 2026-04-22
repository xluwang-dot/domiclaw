/**
 * AI 助手名称
 *
 * 用于显示名称和触发词
 * 默认: "Domiclaw"
 * 触发词: @Domiclaw
 */
export declare const ASSISTANT_NAME: string;
/**
 * 消息轮询间隔（毫秒）
 *
 * 每次检查新消息的间隔时间
 * 默认: 2000ms（2秒）
 */
export declare const POLL_INTERVAL = 2000;
/**
 * 数据库存储目录
 *
 * 存放 SQLite 数据库文件
 * 路径: {项目根}/store
 */
export declare const STORE_DIR: string;
/**
 * 群组工作目录
 *
 * 每个群组有独立的文件夹
 * 路径: {项目根}/groups/{groupFolder}
 */
export declare const GROUPS_DIR: string;
/**
 * 数据目录
 *
 * 存放 IPC、任务等数据
 * 路径: {项目根}/data
 */
export declare const DATA_DIR: string;
/**
 * 模型名称
 *
 * 支持的模型:
 * - DeepSeek: deepseek-chat
 * - Qwen: qwen-turbo, qwen-plus
 * - Anthropic: claude-sonnet-4-20250514
 *
 * 默认: deepseek-chat
 */
export declare const MODEL_NAME: string;
/**
 * 模型 API 基础 URL
 *
 * 用于调用模型服务的地址
 *
 * 示例:
 * - DeepSeek: https://api.deepseek.com
 * - Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1
 * - Anthropic: https://api.anthropic.com
 *
 * 默认: https://api.deepseek.com
 */
export declare const MODEL_BASE_URL: string;
/**
 * 模型 API 密钥
 *
 * 用于认证的 API 密钥
 * 必须从对应模型服务获取
 *
 * 无默认值，需要在 .env 中配置
 */
export declare const MODEL_API_KEY: string;
/**
 * 单次最多处理的消息数
 *
 * 一次 API 调用中发送的最大消息数
 * 用于控制上下文长度
 *
 * 默认: 10
 */
export declare const MAX_MESSAGES_PER_PROMPT: number;
/**
 * 构建触发词正则表达式
 *
 * @param trigger 触发词（如 "Domiclaw" 或 "@Domiclaw"）
 * @returns 正则表达式（匹配行首，不区分大小写）
 *
 * 示例:
 * - 输入: "@Domiclaw" -> /^@Domiclaw\b/i
 * - 只匹配行首，防止匹配在消息中間的触发词
 */
export declare function buildTriggerPattern(trigger: string): RegExp;
/**
 * 默认触发词
 *
 * 由 ASSISTANT_NAME 组成
 * 格式: @{ASSISTANT_NAME}
 *
 * 例如: @Domiclaw
 */
export declare const DEFAULT_TRIGGER: string;
/**
 * 获取触发词正则表达式
 *
 * @param trigger 自定义触发词（可选）
 * @returns 正则表达式
 *
 * 如果提供了自定义触发词则使用它，否则使用默认触发词
 */
export declare function getTriggerPattern(trigger?: string): RegExp;
/**
 * 默认触发词的正则表达式
 *
 * 用于快速匹配
 */
export declare const TRIGGER_PATTERN: RegExp;
//# sourceMappingURL=config.d.ts.map