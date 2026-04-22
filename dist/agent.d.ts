import { RegisteredGroup } from "./types.js";
/**
 * Agent 输入参数
 *
 * 用于传递给模型的输入数据
 */
export interface AgentInput {
    /** 消息历史（格式化后的 XML 字符串）*/
    prompt: string;
    /** 会话 ID（暂未使用，为未来会话功能预留）*/
    sessionId?: string;
    /** 群组文件夹名称（用于创建工作目录）*/
    groupFolder: string;
    /** 聊天 ID（用于标识来源）*/
    chatJid: string;
    /** 是否为主群（主群有更高权限）*/
    isMain: boolean;
    /** 是否为定时任务 */
    isScheduledTask?: boolean;
    /** AI 助手名称 */
    assistantName?: string;
    /** 预留：自定义脚本 */
    script?: string;
}
/**
 * Agent 输出结果
 *
 * 模型调用返回的结果
 */
export interface AgentOutput {
    /** 调用状态 */
    status: "success" | "error";
    /** 生成的回复内容 */
    result: string | null;
    /** 新的会话 ID（用于会话保持）*/
    newSessionId?: string;
    /** 错误信息（如果失败）*/
    error?: string;
}
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
export declare function runAgent(group: RegisteredGroup, input: AgentInput, onOutput?: (output: AgentOutput) => Promise<void>): Promise<AgentOutput>;
//# sourceMappingURL=agent.d.ts.map