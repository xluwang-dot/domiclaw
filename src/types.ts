/**
 * Domiclaw 类型定义模块
 */

/**
 * 新消息
 */
export interface NewMessage {
  /** 消息 ID */
  id: string;
  /** 发送者 ID */
  sender: string;
  /** 发送者显示名称 */
  sender_name: string;
  /** 消息内容 */
  content: string;
  /** 时间戳（ISO 字符串）*/
  timestamp: string;
  /** 是否为机器人发送的消息 */
  is_from_me?: boolean;
  /** 是否为机器人回复的消息 */
  is_bot_message?: boolean;
  /** 话题/线程 ID（可选）*/
  thread_id?: string;
  /** 回复的消息 ID（可选）*/
  reply_to_message_id?: string;
  /** 回复的消息内容（可选）*/
  reply_to_message_content?: string;
  /** 回复的发送者名称（可选）*/
  reply_to_sender_name?: string;
}

// ============== Tool Calling Types ==============

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolContext {
  workspaceDir: string;
  userId: number;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<string>;
}

// ============== Agent Types ==============

export interface AgentInput {
  prompt: string;
  fullContext?: string;
  sessionId?: string;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
  userId: number;
}

export interface AgentOutput {
  status: "success" | "error";
  result: string | null;
  thinking: string | null;
  isPartial?: boolean;
  newSessionId?: string;
  toolEvent?: ToolEvent;
  error?: string;
}

export interface ToolEvent {
  type: "tool_call" | "tool_result";
  name: string;
  args?: Record<string, unknown>;
  resultPreview?: string;
}
