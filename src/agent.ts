import fs from "fs";
import path from "path";

import {
  MODEL_NAME,
  MODEL_BASE_URL,
  MODEL_API_KEY,
  GROUPS_DIR,
  STREAMING_ENABLED,
  THINKING_MODE,
  MAX_CONTEXT_MESSAGES,
  CONTEXT_SUMMARIZE_THRESHOLD,
  MAX_RETRIES,
  RETRY_BASE_DELAY,
  MODEL_NAME_FALLBACK,
  MODEL_BASE_URL_FALLBACK,
  MODEL_API_KEY_FALLBACK,
} from "./config.js";

import { logger } from "./logger.js";
import { RegisteredGroup, ToolContext, ToolDefinition } from "./types.js";
import { getTool, getAllToolDefinitions } from "./tools/index.js";
import {
  getRecentMessages,
  getSessionContext,
  getWeakAreas,
} from "./db.js";

import "./tools/quiz.js";
import "./tools/knowledge.js";
import "./tools/review.js";
import "./tools/study.js";
import "./tools/reminder.js";

const MAX_TOOL_LOOP = 10;

export interface AgentInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
}

export interface AgentOutput {
  status: "success" | "error";
  result: string | null;
  thinking: string | null;
  isPartial?: boolean;
  newSessionId?: string;
  error?: string;
}

interface ChatMessage {
  role: string;
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface StreamResult {
  content: string;
  thinking: string;
  reasoningContent: string;
  toolCalls: ToolCall[];
  finishReason: string;
}

function buildSystemPrompt(
  groupFolder: string,
  assistantName: string,
  chatJid: string,
): string {
  // Base instructions from CLAUDE.md or default
  let instructions: string;
  const mdPath = path.join(GROUPS_DIR, groupFolder, "CLAUDE.md");
  try {
    const content = fs.readFileSync(mdPath, "utf-8").trim();
    instructions = content.startsWith("# ")
      ? content.replace(/^# .+/, `# ${assistantName}`)
      : `# ${assistantName}\n\n${content}`;
  } catch {
    instructions = `You are ${assistantName}, a helpful educational assistant. You help students study by creating quizzes, storing knowledge points, tracking wrong questions, and providing spaced repetition reviews. Use the available tools to manage the student's learning.`;
  }

  // Enrich with session context
  const ctx = getSessionContext(chatJid);
  const weakAreas = getWeakAreas(chatJid);

  const lines: string[] = [];

  if (ctx || weakAreas.length > 0) {
    lines.push("[Session Context]");
    if (ctx?.topic) lines.push(`Current topic: ${ctx.topic}`);
    if (weakAreas.length > 0) lines.push(`Student's weak areas: ${weakAreas.join(", ")}`);
    if (ctx?.summary) lines.push(`Previous discussion: ${ctx.summary}`);
    lines.push("");
  }

  lines.push(instructions);

  return lines.join("\n");
}

function buildSystemPromptScheduled(
  groupFolder: string,
  assistantName: string,
  chatJid: string,
): string {
  const base = buildSystemPrompt(groupFolder, assistantName, chatJid);

  const checkInPrefix = `[Scheduled Check-in]
You are performing a scheduled check-in. The student did not initiate this.
Be proactive but not pushy. Check on their progress and offer help.

1. Check for due spaced repetition reviews (get_due_reviews)
2. Check study plan progress (get_study_progress)
3. If there are upcoming tasks today, mention them
4. Be brief and encouraging — aim for 2-3 sentences max

`;

  return checkInPrefix + base;
}

async function retry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt) + Math.random() * 500;
      logger.warn({ attempt: attempt + 1, delay: Math.round(delay), label }, "Retrying after error");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

interface ModelConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
}

async function nonStreamingApiCall(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model?: ModelConfig,
): Promise<{ content: string | null; toolCalls: ToolCall[]; reasoningContent: string | null }> {
  const m = model || { name: MODEL_NAME, baseUrl: MODEL_BASE_URL, apiKey: MODEL_API_KEY };

  const doCall = async () => {
    const body: Record<string, unknown> = {
      model: m.name,
      messages,
      stream: false,
      thinking_mode: THINKING_MODE,
    };
    if (tools.length > 0) body.tools = tools;

    logger.debug(
      { model: m.name, msgCount: messages.length, toolCount: tools.length, stream: false },
      "API request (non-streaming)",
    );

    const response = await fetch(`${m.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${m.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, body: errorText.substring(0, 500) },
        "API error response",
      );
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason?: string;
      }[];
    };

    const msg = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason;
    const contentPreview = msg?.content?.substring(0, 200) || "";
    logger.info(
      {
        contentLen: msg?.content?.length || 0,
        reasoningLen: msg?.reasoning_content?.length || 0,
        toolCallCount: msg?.tool_calls?.length || 0,
        finishReason,
        contentPreview,
      },
      "API response (non-streaming)",
    );

    return {
      content: msg?.content || null,
      toolCalls: msg?.tool_calls || [],
      reasoningContent: msg?.reasoning_content || null,
    };
  };

  // Try primary, failover to fallback if configured
  try {
    return await retry(doCall, "api-call");
  } catch (err) {
    if (MODEL_NAME_FALLBACK && MODEL_API_KEY_FALLBACK) {
      logger.warn("Primary model failed, trying fallback");
      const fallback: ModelConfig = {
        name: MODEL_NAME_FALLBACK,
        baseUrl: MODEL_BASE_URL_FALLBACK || MODEL_BASE_URL,
        apiKey: MODEL_API_KEY_FALLBACK,
      };
      return nonStreamingApiCall(messages, tools, fallback);
    }
    throw err;
  }
}

async function streamApiCall(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onOutput?: (output: AgentOutput) => Promise<void>,
  model?: ModelConfig,
): Promise<StreamResult> {
  const m = model || { name: MODEL_NAME, baseUrl: MODEL_BASE_URL, apiKey: MODEL_API_KEY };

  const doStream = async () => {
    const body: Record<string, unknown> = {
      model: m.name,
      messages,
      stream: true,
      thinking_mode: THINKING_MODE,
    };
    if (tools.length > 0) body.tools = tools;

    logger.debug(
      { model: m.name, msgCount: messages.length, toolCount: tools.length, stream: true },
      "API request (streaming)",
    );

    const response = await fetch(`${m.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${m.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, body: errorText.substring(0, 500) },
        "API stream error response",
      );
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    return response;
  };

  let response: Response;
  try {
    response = await retry(doStream, "stream-call");
  } catch (err) {
    if (MODEL_NAME_FALLBACK && MODEL_API_KEY_FALLBACK) {
      logger.warn("Primary model failed for stream, trying fallback");
      const fallback: ModelConfig = {
        name: MODEL_NAME_FALLBACK,
        baseUrl: MODEL_BASE_URL_FALLBACK || MODEL_BASE_URL,
        apiKey: MODEL_API_KEY_FALLBACK,
      };
      return streamApiCall(messages, tools, onOutput, fallback);
    }
    throw err;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let content = "";
  let thinking = "";
  const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();
  let finishReason = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        const fr = json.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;

        if (!delta) continue;

        if (delta.reasoning_content) {
          thinking += delta.reasoning_content;
          if (onOutput) {
            await onOutput({
              status: "success",
              result: null,
              thinking: delta.reasoning_content,
              isPartial: true,
            });
          }
        }

        if (delta.content) {
          content += delta.content;
          if (onOutput) {
            await onOutput({
              status: "success",
              result: delta.content,
              thinking: null,
              isPartial: true,
            });
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallAccum.get(tc.index) || { id: "", name: "", args: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolCallAccum.set(tc.index, existing);
          }
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  const toolCalls: ToolCall[] = [...toolCallAccum.values()]
    .filter((tc) => tc.id)
    .map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args },
    }));

  logger.info(
    {
      contentLen: content.length,
      thinkingLen: thinking.length,
      toolCallCount: toolCalls.length,
      finishReason,
      contentPreview: content.substring(0, 200),
      thinkingPreview: thinking.substring(0, 200),
    },
    "API stream complete",
  );

  return { content, thinking, reasoningContent: thinking, toolCalls, finishReason };
}

export async function runAgent(
  group: RegisteredGroup,
  input: AgentInput,
  onOutput?: (output: AgentOutput) => Promise<void>,
): Promise<AgentOutput> {
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    {
      group: group.name,
      model: MODEL_NAME,
      streaming: STREAMING_ENABLED,
      thinkingMode: THINKING_MODE,
      scheduled: input.isScheduledTask || false,
      promptLen: input.prompt.length,
    },
    "Agent starting",
  );

  if (!MODEL_API_KEY) {
    const error = "MODEL_API_KEY not configured";
    logger.error({ group: group.name }, error);
    return { status: "error", result: null, thinking: null, error };
  }

  const assistantName = input.assistantName || "Domiclaw";
  const systemPrompt = input.isScheduledTask
    ? buildSystemPromptScheduled(group.folder, assistantName, input.chatJid)
    : buildSystemPrompt(group.folder, assistantName, input.chatJid);
  const tools = getAllToolDefinitions();
  const toolCtx: ToolContext = {
    groupFolder: groupDir,
    chatJid: input.chatJid,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input.prompt },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_LOOP; iteration++) {
    logger.info({ iteration, msgCount: messages.length }, "Calling model API");

    try {
      // Stream only on first iteration; tool-calling follow-ups use non-streaming
      if (iteration === 0 && STREAMING_ENABLED) {
        const streamResult = await streamApiCall(messages, tools, onOutput);

        // Model returned text content without tool calls
        if (streamResult.content && streamResult.toolCalls.length === 0) {
          if (onOutput) {
            await onOutput({
              status: "success",
              result: streamResult.content,
              thinking: null,
              isPartial: false,
            });
          }
          return {
            status: "success",
            result: streamResult.content,
            thinking: streamResult.thinking || null,
          };
        }

        // Model requested tool calls
        if (streamResult.toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: streamResult.content || null,
            reasoning_content: streamResult.reasoningContent || undefined,
            tool_calls: streamResult.toolCalls,
          });

          for (const tc of streamResult.toolCalls) {
            const toolName = tc.function.name;
            const tool = getTool(toolName);
            logger.info({ tool: toolName }, "Executing tool");

            let toolResult: string;
            if (!tool) {
              toolResult = `Error: unknown tool "${toolName}". Available: ${getAllToolDefinitions().map(t => t.function.name).join(", ")}`;
            } else {
              try {
                const parsedArgs = JSON.parse(tc.function.arguments);
                toolResult = await tool.execute(parsedArgs, toolCtx);
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                toolResult = `Error executing ${toolName}: ${errMsg}`;
                logger.error({ tool: toolName, err }, "Tool execution error");
              }
            }
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult,
            });
          }
          continue;
        }

        // Stream finished without content — error
        return { status: "error", result: null, thinking: null, error: "Stream completed without content" };
      }

      // Non-streaming path (tool-calling follow-ups or streaming disabled)
      const result = await nonStreamingApiCall(messages, tools);

      if (result.content) {
        if (onOutput) {
          await onOutput({ status: "success", result: result.content, thinking: null });
        }
        return { status: "success", result: result.content, thinking: null };
      }

      if (result.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: result.content,
          reasoning_content: result.reasoningContent || undefined,
          tool_calls: result.toolCalls,
        });

        for (const tc of result.toolCalls) {
          const toolName = tc.function.name;
          const tool = getTool(toolName);
          logger.info({ tool: toolName }, "Executing tool");

          let toolResult: string;
          if (!tool) {
            toolResult = `Error: unknown tool "${toolName}". Available: ${getAllToolDefinitions().map(t => t.function.name).join(", ")}`;
          } else {
            try {
              const parsedArgs = JSON.parse(tc.function.arguments);
              toolResult = await tool.execute(parsedArgs, toolCtx);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              toolResult = `Error executing ${toolName}: ${errMsg}`;
              logger.error({ tool: toolName, err }, "Tool execution error");
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
        continue;
      }

      return { status: "error", result: null, thinking: null, error: "Response has no content or tool calls" };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ group: group.name, error: errorMessage }, "Agent error");
      if (onOutput) {
        await onOutput({ status: "error", result: null, thinking: null, error: errorMessage });
      }
      return { status: "error", result: null, thinking: null, error: errorMessage };
    }
  }

  return { status: "error", result: null, thinking: null, error: "Max tool loop iterations exceeded" };
}
