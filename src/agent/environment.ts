import fs from "fs";
import path from "path";

import { DATA_DIR } from "../config.js";
import { ToolContext } from "../types.js";
import { getSessionContext, getWeakAreas } from "../db.js";
import { getTool, getAllToolDefinitions } from "../tools/index.js";
import { logger } from "../logger.js";

import "../tools/quiz.js";
import "../tools/knowledge.js";
import "../tools/review.js";
import "../tools/study.js";
import "../tools/reminder.js";
import "../tools/analyze.js";

export function buildSystemPrompt(
  userId: number, assistantName: string,
): string {
  let instructions: string;
  const mdPath = path.join(DATA_DIR, "agent", "AGENT.md");
  try {
    const content = fs.readFileSync(mdPath, "utf-8").trim();
    instructions = content.startsWith("# ")
      ? content.replace(/^# .+/, `# ${assistantName}`)
      : `# ${assistantName}\n\n${content}`;
  } catch {
    instructions = `You are ${assistantName}, a helpful educational assistant. You help students study by creating quizzes, storing knowledge points, tracking wrong questions, and providing spaced repetition reviews. Use the available tools to manage the student's learning.`;
  }

  const ctx = getSessionContext(userId);
  const weakAreas = getWeakAreas(userId);

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

export function buildSystemPromptScheduled(
  userId: number, assistantName: string,
): string {
  const base = buildSystemPrompt(userId, assistantName);
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

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tool = getTool(name);

  if (!tool) {
    const available = getAllToolDefinitions().map((t) => t.function.name).join(", ");
    return `Error: unknown tool "${name}". Available: ${available}`;
  }

  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ tool: name, err }, "Tool execution error");
    return `Error executing ${name}: ${errMsg}`;
  }
}
