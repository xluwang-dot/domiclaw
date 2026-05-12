import fs from "fs";

import {
  MODEL_NAME, MODEL_API_KEY,
  STREAMING_ENABLED, THINKING_MODE,
  WORKSPACE_DIR,
} from "../config.js";

import { logger } from "../logger.js";
import { AgentInput, AgentOutput, ToolContext } from "../types.js";
import { getAllToolDefinitions } from "../tools/index.js";

import {
  nonStreamingApiCall, streamApiCall,
  ChatMessage, ToolCall,
} from "./model.js";

import {
  buildSystemPrompt, buildSystemPromptScheduled,
  executeTool,
} from "./environment.js";

const MAX_TOOL_LOOP = 10;

export async function runAgent(
  input: AgentInput,
  onOutput?: (output: AgentOutput) => Promise<void>,
): Promise<AgentOutput> {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  logger.info(
    { model: MODEL_NAME, streaming: STREAMING_ENABLED,
      thinkingMode: THINKING_MODE, scheduled: input.isScheduledTask || false,
      userId: input.userId, promptLen: input.prompt.length },
    "Agent starting",
  );

  if (!MODEL_API_KEY) {
    const error = "MODEL_API_KEY not configured";
    logger.error(error);
    return { status: "error", result: null, thinking: null, error };
  }

  const assistantName = input.assistantName || "Domiclaw";
  const systemPrompt = input.isScheduledTask
    ? buildSystemPromptScheduled(input.userId, assistantName)
    : buildSystemPrompt(input.userId, assistantName);
  const tools = getAllToolDefinitions();
  const toolCtx: ToolContext = {
    workspaceDir: WORKSPACE_DIR,
    userId: input.userId,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input.prompt },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_LOOP; iteration++) {
    logger.info({ iteration, msgCount: messages.length }, "Calling model API");

    try {
      if (iteration === 0 && STREAMING_ENABLED) {
        const streamResult = await streamApiCall(
          messages, tools,
          onOutput
            ? async (out) => {
              await onOutput({ status: "success", result: out.result, thinking: out.thinking, isPartial: true });
            }
            : undefined,
        );

        if (streamResult.content && streamResult.toolCalls.length === 0) {
          if (onOutput) {
            await onOutput({ status: "success", result: streamResult.content, thinking: null, isPartial: false });
          }
          return { status: "success", result: streamResult.content, thinking: streamResult.thinking || null };
        }

        if (streamResult.toolCalls.length > 0) {
          messages.push({
            role: "assistant", content: streamResult.content || null,
            reasoning_content: streamResult.reasoningContent || undefined,
            tool_calls: streamResult.toolCalls,
          });

          for (const tc of streamResult.toolCalls) {
            const toolName = tc.function.name;
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(tc.function.arguments);
            } catch { /* keep empty args */ }

            if (onOutput) {
              await onOutput({
                status: "success", result: null, thinking: null, isPartial: true,
                toolEvent: { type: "tool_call", name: toolName, args: parsedArgs },
              });
            }

            const toolResult = await executeTool(toolName, parsedArgs, toolCtx);
            messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });

            if (onOutput) {
              await onOutput({
                status: "success", result: null, thinking: null, isPartial: true,
                toolEvent: {
                  type: "tool_result", name: toolName,
                  resultPreview: toolResult.substring(0, 200),
                },
              });
            }
          }
          continue;
        }

        return { status: "error", result: null, thinking: null, error: "Stream completed without content" };
      }

      const result = await nonStreamingApiCall(messages, tools);

      if (result.content || result.toolCalls.length > 0) {
        messages.push({
          role: "assistant", content: result.content,
          reasoning_content: result.reasoningContent || undefined,
          tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        });
      }

      if (result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          const toolName = tc.function.name;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments);
          } catch { /* keep empty args */ }

          if (onOutput) {
            await onOutput({
              status: "success", result: null, thinking: null, isPartial: true,
              toolEvent: { type: "tool_call", name: toolName, args: parsedArgs },
            });
          }

          const toolResult = await executeTool(toolName, parsedArgs, toolCtx);
          messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });

          if (onOutput) {
            await onOutput({
              status: "success", result: null, thinking: null, isPartial: true,
              toolEvent: {
                type: "tool_result", name: toolName,
                resultPreview: toolResult.substring(0, 200),
              },
            });
          }
        }
        continue;
      }

      if (result.content) {
        if (onOutput) await onOutput({ status: "success", result: result.content, thinking: null });
        return { status: "success", result: result.content, thinking: null };
      }

      return { status: "success", result: null, thinking: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ error: errorMessage }, "Agent error");
      if (onOutput) await onOutput({ status: "error", result: null, thinking: null, error: errorMessage });
      return { status: "error", result: null, thinking: null, error: errorMessage };
    }
  }

  return { status: "error", result: null, thinking: null, error: "Max tool loop iterations exceeded" };
}
