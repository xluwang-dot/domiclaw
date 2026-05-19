import fs from "fs";
import path from "path";

import { DATA_DIR } from "../config.js";
import { ToolContext } from "../types.js";
import { getSessionContext, getWeakAreas } from "../db.js";
import { getTool, getAllToolDefinitions } from "../tools/index.js";
import { retrieveRelevant } from "../rag/index.js";
import { logger } from "../logger.js";
import { getCurrentQuestion } from "./questionContext.js";

import "../tools/quiz.js";
import "../tools/knowledge.js";
import "../tools/review.js";
import "../tools/study.js";
import "../tools/reminder.js";
import "../tools/analyze.js";

export async function buildSystemPrompt(
  userId: number, assistantName: string, userInput?: string,
): Promise<{ systemPrompt: string; ragCount: number }> {
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

  let ragCount = 0;
  if (userInput) {
    const ragResults = await retrieveRelevant(userInput);
    ragCount = ragResults.length;
    if (ragCount > 0) {
      lines.push("[Retrieved Knowledge]");
      for (const r of ragResults) {
        const snippet = r.content.substring(0, 200);
        lines.push(`- ${r.title}${snippet ? `: ${snippet}` : ""}`);
      }
      lines.push("");
      lines.push("以下是你已经拥有的知识点文本内容，可直接用于回答知识性问题。但如需创建测验获取知识点 ID，仍需调用 search_knowledge。");
      lines.push("");
    }
  }

  const currentQ = getCurrentQuestion(userId);
  if (currentQ) {
    lines.push("[Current Question]");
    lines.push(`题目：${currentQ.questionText}`);
    if (currentQ.subQuestions && currentQ.subQuestions.length > 0) {
      lines.push(`子问题：${currentQ.subQuestions.join(" | ")}`);
    }
    lines.push(`已完成：${currentQ.progress.solvedSubIndices.map(i => `第${i + 1}问`).join(", ") || "暂无"}`);
    lines.push(`当前正在做：第 ${currentQ.progress.currentSubIndex + 1} 问`);
    lines.push("");
  }

  lines.push(instructions);
  lines.push("");
  lines.push("=== 硬约束规则（以下规则优先级高于上述AGENT.md中的常规指令） ===");
  lines.push("");
  lines.push("## 1. 出题规则（必须遵守）");
  lines.push("- 当用户要求创建测验或出题，且提到了具体的知识点名称（如\"二次函数\"\"勾股定理\"\"一元一次方程\"）时，你必须按以下顺序操作：");
  lines.push("  1. 先调用 search_knowledge 查找该知识点，获取其 ID。");
  lines.push("  2. 然后调用 create_quiz，并将查到的知识点 ID 传入 knowledge_point 参数。");
  lines.push("- 澄清：即使系统已提供知识点的文本内容（用于回答知识性问题），创建测验时仍需调用 search_knowledge 获取知识点 ID，因为 create_quiz 需要 ID 作为参数。");
  lines.push("- 如果 search_knowledge 返回了多个匹配结果，选择最匹配的那一个，或列出让用户确认。");
  lines.push("- 如果 search_knowledge 未找到匹配结果，告知用户该知识点不存在，不要擅自出题。");
  lines.push("- 只有当用户明确表示\"随便出题\"\"综合练习\"且未指定知识点时，才使用 test_level 模式。");
  lines.push("");
  lines.push("## 2. 难度映射规则（必须遵守）");
  lines.push("- 当用户描述中使用了难度相关词汇时，按以下映射设置 create_quiz 参数：");
  lines.push("  - \"基础\"\"简单\"\"入门\"\"容易\" → test_level=1 或 max_difficulty=2");
  lines.push("  - \"中等\"\"一般\" → test_level=2 或 min_difficulty=2, max_difficulty=3");
  lines.push("  - \"难\"\"挑战\"\"困难\"\"提高\" → test_level=3 或 min_difficulty=3");
  lines.push("- 如果用户同时指定了知识点和难度，两个参数都要传入 create_quiz。");
  lines.push("");
  lines.push("## 3. 纠错与重试规则（必须遵守）");
  lines.push("- 如果用户指出你返回的结果与预期不符（如\"这不是我要的\"\"题目不对\"\"这不是二次函数\"），你必须：");
  lines.push("  1. 检查上一次工具调用的参数是否遗漏了关键过滤条件（如 knowledge_point、subject、difficulty）。");
  lines.push("  2. 补充正确的参数后，重新调用工具。");
  lines.push("  3. 不要转向\"那你想要什么？\"之类的对话，直接修正并重试。");
  lines.push("- 如果连续两次重试后用户仍然不满意，再询问用户具体需求。");
  lines.push("");
  lines.push("## 4. 讲解规则（必须遵守）");
  lines.push("- 当你正在讲解一道题目时，用户的所有回复都应首先视为对该讲解的回应，而非新问题。");
  lines.push("- 如果用户回答了你在讲解中提出的引导性问题，你必须先判断该答案是否正确，再继续讲解。");
  lines.push("- 只有当用户明确表示\"换一题\"\"不讲了\"\"问个新问题\"时，才退出讲解模式。");
  lines.push("- 在讲解过程中，始终保持对以下信息的追踪：");
  lines.push("  - 当前正在讲解的题目 ID");
  lines.push("  - 当前讲解步骤");
  lines.push("  - 用户是否已经回答了当前步骤的问题");
  lines.push("");
  lines.push("## 5. 冲突解决规则（必须遵守）");
  lines.push("当本文件中的多条规则互相冲突时，按以下优先级执行：");
  lines.push("1. 纠错与重试规则（用户实时反馈 > 预设规则）");
  lines.push("2. 出题规则");
  lines.push("3. 讲解规则");
  lines.push("4. AGENT.md 中的常规指令");
  lines.push("");
  return { systemPrompt: lines.join("\n"), ragCount };
}

export async function buildSystemPromptScheduled(
  userId: number, assistantName: string,
): Promise<{ systemPrompt: string; ragCount: number }> {
  const { systemPrompt: base, ragCount } = await buildSystemPrompt(userId, assistantName);
  const checkInPrefix = `[Scheduled Check-in]
You are performing a scheduled check-in. The student did not initiate this.
Be proactive but not pushy. Check on their progress and offer help.

1. Check for due spaced repetition reviews (get_due_reviews)
2. Check study plan progress (get_study_progress)
3. If there are upcoming tasks today, mention them
4. Be brief and encouraging — aim for 2-3 sentences max

`;
  return { systemPrompt: checkInPrefix + base, ragCount };
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
