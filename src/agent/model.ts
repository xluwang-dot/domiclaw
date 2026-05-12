import {
  MODEL_NAME, MODEL_BASE_URL, MODEL_API_KEY,
  THINKING_MODE,
  MAX_RETRIES, RETRY_BASE_DELAY,
  MODEL_NAME_FALLBACK, MODEL_BASE_URL_FALLBACK, MODEL_API_KEY_FALLBACK,
} from "../config.js";

import { logger } from "../logger.js";
import { ToolDefinition } from "../types.js";

export interface ChatMessage {
  role: string;
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ModelConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface NonStreamResult {
  content: string | null;
  toolCalls: ToolCall[];
  reasoningContent: string | null;
}

export interface StreamResult {
  content: string;
  thinking: string;
  reasoningContent: string;
  toolCalls: ToolCall[];
  finishReason: string;
}

const DEFAULT_MODEL: ModelConfig = {
  name: MODEL_NAME,
  baseUrl: MODEL_BASE_URL,
  apiKey: MODEL_API_KEY,
};

function hasFallback(): boolean {
  return !!(MODEL_NAME_FALLBACK && MODEL_API_KEY_FALLBACK);
}

function fallbackModel(): ModelConfig {
  return {
    name: MODEL_NAME_FALLBACK,
    baseUrl: MODEL_BASE_URL_FALLBACK || MODEL_BASE_URL,
    apiKey: MODEL_API_KEY_FALLBACK,
  };
}

interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
}

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions, label: string): Promise<T> {
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === options.maxRetries) throw err;
      const delay = options.baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      logger.warn({ attempt: attempt + 1, delay: Math.round(delay), label }, "Retrying after error");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

export async function nonStreamingApiCall(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model?: ModelConfig,
): Promise<NonStreamResult> {
  const m = model || DEFAULT_MODEL;

  const doCall = async () => {
    const body: Record<string, unknown> = {
      model: m.name, messages, stream: false, thinking_mode: THINKING_MODE,
    };
    if (tools.length > 0) body.tools = tools;

    logger.debug(
      { model: m.name, msgCount: messages.length, toolCount: tools.length, stream: false },
      "API request (non-streaming)",
    );

    const response = await fetch(`${m.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${m.apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, body: errorText.substring(0, 500) }, "API error response");
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
    };

    const msg = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason;
    logger.info(
      { contentLen: msg?.content?.length || 0, reasoningLen: msg?.reasoning_content?.length || 0,
        toolCallCount: msg?.tool_calls?.length || 0, finishReason,
        contentPreview: msg?.content?.substring(0, 200) || "" },
      "API response (non-streaming)",
    );

    return {
      content: msg?.content || null,
      toolCalls: msg?.tool_calls || [],
      reasoningContent: msg?.reasoning_content || null,
    };
  };

  try {
    return await withRetry(doCall, { maxRetries: MAX_RETRIES, baseDelay: RETRY_BASE_DELAY }, "api-call");
  } catch (err) {
    if (hasFallback()) {
      logger.warn("Primary model failed, trying fallback");
      return nonStreamingApiCall(messages, tools, fallbackModel());
    }
    throw err;
  }
}

export async function streamApiCall(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onOutput?: (output: { status: "success"; result: string | null; thinking: string | null; isPartial: boolean }) => Promise<void>,
  model?: ModelConfig,
): Promise<StreamResult> {
  const m = model || DEFAULT_MODEL;

  const doStream = async () => {
    const body: Record<string, unknown> = {
      model: m.name, messages, stream: true, thinking_mode: THINKING_MODE,
    };
    if (tools.length > 0) body.tools = tools;

    logger.debug(
      { model: m.name, msgCount: messages.length, toolCount: tools.length, stream: true },
      "API request (streaming)",
    );

    const response = await fetch(`${m.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${m.apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, body: errorText.substring(0, 500) }, "API stream error response");
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    return response;
  };

  let response: Response;
  try {
    response = await withRetry(doStream, { maxRetries: MAX_RETRIES, baseDelay: RETRY_BASE_DELAY }, "stream-call");
  } catch (err) {
    if (hasFallback()) {
      logger.warn("Primary model failed for stream, trying fallback");
      return streamApiCall(messages, tools, onOutput, fallbackModel());
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
            await onOutput({ status: "success", result: null, thinking: delta.reasoning_content, isPartial: true });
          }
        }

        if (delta.content) {
          content += delta.content;
          if (onOutput) {
            await onOutput({ status: "success", result: delta.content, thinking: null, isPartial: true });
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
      } catch { /* skip malformed JSON */ }
    }
  }

  const toolCalls: ToolCall[] = [...toolCallAccum.values()]
    .filter((tc) => tc.id)
    .map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.args } }));

  logger.info(
    { contentLen: content.length, thinkingLen: thinking.length, toolCallCount: toolCalls.length,
      finishReason, contentPreview: content.substring(0, 200), thinkingPreview: thinking.substring(0, 200) },
    "API stream complete",
  );

  return { content, thinking, reasoningContent: thinking, toolCalls, finishReason };
}
