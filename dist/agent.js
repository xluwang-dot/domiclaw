/**
 * Domiclaw Agent - 模型 API 调用模块
 *
 * 负责调用外部模型的 Chat API，生成回复内容。
 *
 * 支持的模型（通过配置）:
 * - DeepSeek (deepseek-chat)
 * - Qwen (qwen-turbo)
 * - Anthropic (claude-sonnet-4-20250514)
 * - 任何 OpenAI 兼容的 API
 *
 * API 调用格式:
 * POST {MODEL_BASE_URL}/chat/completions
 * Body: { model, messages: [{role, content}], stream: false }
 * Response: { choices: [{message: {content}}] }
 */
import fs from "fs";
import path from "path";
import { MODEL_NAME, // 模型名称（如 "deepseek-chat"）
MODEL_BASE_URL, // API 基础 URL（如 "https://api.deepseek.com"）
MODEL_API_KEY, // API 密钥
GROUPS_DIR, // 群组目录
 } from "./config.js";
import { logger } from "./logger.js";
/**
 * 运行 Agent - 调用模型 API 生成回复
 *
 * @param group 群组配置
 * @param input 输入参数
 * @param onOutput 可选的输出回调（流式输出时用到）
 * @returns AgentOutput 调用结果
 *
 * 处理流程:
 * 1. 创建群组工作目录
 * 2. 检查 API 密钥
 * 3. 调用模型 API
 * 4. 解析返回内容
 * 5. 返回结果
 *
 * @example
 * ```ts
 * const result = await runAgent(group, { prompt: "你好" });
 * if (result.status === "success") {
 *   console.log(result.result); // 模型回复
 * }
 * ```
 */
export async function runAgent(group, input, onOutput) {
    // 1. 确保群组工作目录存在
    const groupDir = path.join(GROUPS_DIR, group.folder);
    fs.mkdirSync(groupDir, { recursive: true });
    // 记录调用信息
    logger.info({ group: group.name, model: MODEL_NAME, baseUrl: MODEL_BASE_URL }, "正在调用模型 API");
    // 2. 检查 API 密钥是否配置
    if (!MODEL_API_KEY) {
        const error = "MODEL_API_KEY 未配置，请在 .env 中设置";
        logger.error({ group: group.name }, error);
        return { status: "error", result: null, error };
    }
    try {
        // 3. 调用模型 Chat API
        const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                // JSON 格式
                "Content-Type": "application/json",
                // Bearer 认证
                Authorization: `Bearer ${MODEL_API_KEY}`,
            },
            body: JSON.stringify({
                // 模型名称
                model: MODEL_NAME,
                // 消息历史（格式化的 XML）
                messages: [{ role: "user", content: input.prompt }],
                // 非流式输出
                stream: false,
            }),
        });
        // 4. 检查 HTTP 响应
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 错误: ${response.status} - ${errorText}`);
        }
        // 5. 解析 JSON 响应
        const data = (await response.json());
        // 6. 提取回复内容
        const content = data.choices?.[0]?.message?.content || "";
        // 7. 如果有回调则调用（用于流式输出时的实时反馈）
        if (onOutput) {
            await onOutput({ status: "success", result: content });
        }
        // 8. 返回成功结果
        return {
            status: "success",
            result: content,
        };
    }
    catch (err) {
        // 处理错误
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ group: group.name, error: errorMessage }, "Agent 错误");
        // 如果有回调则调用
        if (onOutput) {
            await onOutput({ status: "error", result: null, error: errorMessage });
        }
        // 返回错误结果
        return {
            status: "error",
            result: null,
            error: errorMessage,
        };
    }
}
//# sourceMappingURL=agent.js.map