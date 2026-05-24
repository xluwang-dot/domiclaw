import fs from "fs";
import path from "path";

import { DATA_DIR } from "../config.js";
import { ToolContext } from "../types.js";
import { getSessionContext, getWeakAreas, getStudyPlansByUser, getPlanProgressStats, isPlanCompleted } from "../db.js";
import { getTool, getAllToolDefinitions } from "../tools/index.js";
import { retrieveRelevant } from "../rag/index.js";
import { logger } from "../logger.js";
import { getCurrentQuestion } from "./questionContext.js";
import { TaskEngine } from "../task/taskEngine.js";

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
    if (currentQ.sessionId) {
      lines.push(`当前测验会话 ID：${currentQ.sessionId}`);
    }
    if (currentQ.questions && currentQ.questions.length > 1) {
      lines.push(`当前测验共 ${currentQ.questions.length} 题：`);
      for (const q of currentQ.questions) {
        const idx = currentQ.questions.indexOf(q) + 1;
        const opts = q.options ? ` (有选项)` : "";
        lines.push(`  第${idx}题 (ID:${q.id}) [${q.type}]${opts}: ${q.text.substring(0, 120)}`);
      }
    } else {
      lines.push(`题目：${currentQ.questionText}`);
    }
    if (currentQ.subQuestions && currentQ.subQuestions.length > 0) {
      lines.push(`子问题：${currentQ.subQuestions.join(" | ")}`);
    }
    const solved = currentQ.progress.solvedSubIndices;
    if (solved.length > 0) {
      lines.push(`已完成：${solved.map(i => `第${i + 1}问`).join(", ")}`);
    }
    lines.push(`当前正在做：第 ${currentQ.progress.currentSubIndex + 1} 问`);
    lines.push("");
  }

  const currentTask = TaskEngine.getCurrentTask(userId);
  if (currentTask) {
    lines.push(TaskEngine.buildTaskPrompt(currentTask));
    lines.push("");
  }

  // 注入用户计划状态
  const plans = getStudyPlansByUser(userId);
  const hasPlan = plans.length > 0;
  const hasMathCompleted = isPlanCompleted(userId, 1);
  lines.push("[用户计划状态]");
  if (hasPlan) {
    lines.push(`学习计划数：${plans.length}`);
    const activePlan = plans[0];
    const planTasks: { completed: boolean }[] = JSON.parse(activePlan.plan_data);
    const done = planTasks.filter(t => t.completed).length;
    lines.push(`最近计划：${activePlan.title}（${done}/${planTasks.length} 已完成）`);
  } else {
    lines.push("无学习计划。学生尚未进行1号计划摸底，也没有任何学习计划。");
    lines.push('建议：如果学生说「想学习」「开始」「有什么可以做的」，主动建议进行1号计划摸底。');
  }
  if (hasMathCompleted) {
    lines.push("数学1号计划摸底已完成，系统已生成复习计划。");
  }
  lines.push("");

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
lines.push("## 5. 出题展示规则（必须遵守）");
lines.push("- 调用 create_quiz 工具后，你必须在回复中逐题列出完整的题目内容（包括题目文本和所有选项），禁止只输出题型概要或考点表格。");
lines.push("- 回复格式要求：每个题目独占一个段落，以\"**第N题**\"开头，完整显示题目文字和选项，让用户能看到完整的题目内容才能作答。");
lines.push("- 如果题目数量超过 5 题，你可以先展示所有题目再附总结，但不允许省略任何题目的完整内容。");
lines.push("");
lines.push("## 6. 系统通知处理规则（必须遵守）");
lines.push("- 当收到以「[系统] 用户完成了」开头的消息时，消息中已包含测验的核心统计信息（正确数/总题数、session_id、知识点名称）。");
lines.push("- 你**不必**调用 get_quiz_session 查询详情——消息里已有足够数据。");
lines.push("- 直接根据已有信息分析：正确率评估、薄弱点判断。");
lines.push("- 如需获取用户整体掌握情况，调用 get_study_stats。");
lines.push("- 如需查找知识点讲解内容，调用 search_knowledge。");
lines.push("");
lines.push("## 7. 冲突解决规则（必须遵守）");
lines.push("当本文件中的多条规则互相冲突时，按以下优先级执行：");
lines.push("1. 纠错与重试规则（用户实时反馈 > 预设规则）");
lines.push("2. 出题规则");
lines.push("3. 系统通知处理规则");
lines.push("4. 出题展示规则");
lines.push("5. 讲解规则");
lines.push("6. AGENT.md 中的常规指令");
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

  // 任务模式：进入前检查工具是否允许
  const currentTask = TaskEngine.getCurrentTask(ctx.userId);
  if (currentTask) {
    if (!TaskEngine.taskGuard(name, currentTask)) {
      const msg = `当前任务模式下不允许调用 ${name}`;
      logger.warn({ tool: name, taskType: currentTask.type }, msg);
      return `Error: ${msg}`;
    }
    // 在 self_eval 任务中调 create_quiz → 推入嵌套 quiz 任务
    if (name === "create_quiz" && currentTask.type === "self_eval") {
      const kpId = args.knowledge_point as number | undefined;
      const quizTask = TaskEngine.buildTaskItem("quiz", kpId ? `${currentTask.title} 测验` : "摸底测验");
      TaskEngine.startTask(ctx.userId, quizTask);
    }
    // 更新任务阶段
    TaskEngine.updatePhase(ctx.userId, "during");
  } else {
    // 无活跃任务时，自动推断是否需要进入任务模式
    const inferred = TaskEngine.inferTask(name, ctx.userId, args);
    if (inferred) {
      TaskEngine.startTask(ctx.userId, inferred);
    }
  }

  try {
    const result = await tool.execute(args, ctx);

    // 任务执行后：更新上下文（如记录 quiz_session_id）
    if (currentTask || TaskEngine.getCurrentTask(ctx.userId)) {
      if (name === "create_quiz") {
        const sessionMatch = result.match(/session_id=(\d+)/);
        if (sessionMatch) {
          const task = TaskEngine.getCurrentTask(ctx.userId);
          if (task) {
            task.context = { ...task.context, quizSessionId: parseInt(sessionMatch[1], 10) };
            TaskEngine.updatePhase(ctx.userId, "during");
          }
        }
      }
    }

    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ tool: name, err }, "Tool execution error");
    return `Error executing ${name}: ${errMsg}`;
  }
}
