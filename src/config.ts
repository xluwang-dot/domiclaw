/**
 * Domiclaw 配置模块
 *
 * 从 .env 文件读取配置，支持环境变量覆盖。
 *
 * 配置优先级:
 * 1. 环境变量（如 process.env.MODEL_API_KEY）
 * 2. .env 文件
 * 3. 默认值
 */
import path from "path";

import { readEnvFile } from "./env.js";

/**
 * 从 .env 文件读取的配置项列表
 *
 * 这些配置可以通过环境变量或 .env 文件设置
 */
const envConfig = readEnvFile([
  "ASSISTANT_NAME", // AI 助手名称
  "MODEL_NAME", // 模型名称
  "MODEL_BASE_URL", // API 基础 URL
  "MODEL_API_KEY", // API 密钥
]);

// ============== 核心配置 ==============

/**
 * AI 助手名称
 *
 * 用于显示名称和触发词
 * 默认: "Domiclaw"
 * 触发词: @Domiclaw
 */
export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || "Domiclaw";

/**
 * 消息轮询间隔（毫秒）
 *
 * 每次检查新消息的间隔时间
 * 默认: 2000ms（2秒）
 */
export const POLL_INTERVAL = 2000;

// ============== 目录配置 ==============

// 项目根目录（当前工作目录）
const PROJECT_ROOT = process.cwd();

/**
 * 数据库存储目录
 *
 * 存放 SQLite 数据库文件
 * 路径: {项目根}/store
 */
export const STORE_DIR = path.resolve(PROJECT_ROOT, "store");

/**
 * 群组工作目录
 *
 * 每个群组有独立的文件夹
 * 路径: {项目根}/groups/{groupFolder}
 */
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, "groups");

/**
 * 数据目录
 *
 * 存放 IPC、任务等数据
 * 路径: {项目根}/data
 */
export const DATA_DIR = path.resolve(PROJECT_ROOT, "data");

// ============== 模型配置 ==============

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
export const MODEL_NAME =
  process.env.MODEL_NAME || envConfig.MODEL_NAME || "deepseek-chat";

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
export const MODEL_BASE_URL =
  process.env.MODEL_BASE_URL ||
  envConfig.MODEL_BASE_URL ||
  "https://api.deepseek.com";

/**
 * 模型 API 密钥
 *
 * 用于认证的 API 密钥
 * 必须从对应模型服务获取
 *
 * 无默认值，需要在 .env 中配置
 */
export const MODEL_API_KEY =
  process.env.MODEL_API_KEY || envConfig.MODEL_API_KEY || "";

/**
 * 单次最多处理的消息数
 *
 * 一次 API 调用中发送的最大消息数
 * 用于控制上下文长度
 *
 * 默认: 10
 */
export const MAX_MESSAGES_PER_PROMPT = Math.max(
  1,
  parseInt(process.env.MAX_MESSAGES_PER_PROMPT || "10", 10) || 10,
);

// ============== 触发词配置 ==============

/**
 * 转义正则表达式特殊字符
 *
 * @param str 输入字符串
 * @returns 转义后的字符串
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
export function buildTriggerPattern(trigger: string): RegExp {
  return new RegExp(`^${escapeRegex(trigger.trim())}\\b`, "i");
}

/**
 * 默认触发词
 *
 * 由 ASSISTANT_NAME 组成
 * 格式: @{ASSISTANT_NAME}
 *
 * 例如: @Domiclaw
 */
export const DEFAULT_TRIGGER = `@${ASSISTANT_NAME}`;

/**
 * 获取触发词正则表达式
 *
 * @param trigger 自定义触发词（可选）
 * @returns 正则表达式
 *
 * 如果提供了自定义触发词则使用它，否则使用默认触发词
 */
export function getTriggerPattern(trigger?: string): RegExp {
  const normalizedTrigger = trigger?.trim();
  return buildTriggerPattern(normalizedTrigger || DEFAULT_TRIGGER);
}

/**
 * 默认触发词的正则表达式
 *
 * 用于快速匹配
 */
export const TRIGGER_PATTERN = buildTriggerPattern(DEFAULT_TRIGGER);
