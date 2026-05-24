/**
 * 自适应查询缓存层（AQC）
 *
 * 对用户的查询类问题，优先从缓存查找匹配的查询方案并执行。
 * 缓存未命中时调用一次轻量 LLM 分类，执行后自动缓存。
 *
 * __CARD__ 指令：画布操作统一入口，在 routeViaCache 最顶部被拦截，
 * 直接调用工具执行，不查缓存、不走 LLM。
 */
import { nonStreamingApiCall } from "./agent/model.js";
import {
  MODEL_NAME, MODEL_BASE_URL, MODEL_API_KEY,
} from "./config.js";
import { logger } from "./logger.js";
import {
  findCachedQuery,
  insertCachedQuery,
  deleteCachedQuery,
  getStudyStats,
  getDueReviews,
  getWrongQuestionsBySubject,
  getActiveStudyPlan,
  getStudyPlanProgress,
  getSubjectByName,
  getAllSubjects,
} from "./db.js";
import { getTool, getAllToolDefinitions } from "./tools/index.js";
import { renderProgressBar } from "./tools/utils.js";
import { ToolContext } from "./types.js";

export interface QueryResult {
  intent: string;
  params: Record<string, unknown>;
  operation: { action: string; params: Record<string, unknown> };
}

/**
 * 尝试通过缓存匹配用户查询，命中则本地执行返回结果，否则返回 null
 */
export async function routeViaCache(
  userInput: string, userId: number, assistantName: string,
): Promise<string | null> {
  // ── __CARD__ 指令拦截：画布操作直接执行工具，跳过缓存和 LLM ──
  if (userInput.startsWith("__CARD__:")) {
    return handleCardCommand(userInput, userId);
  }

  const input = userInput.trim().toLowerCase();

  // Skip cache for plan/creation conversations — follow-up messages need Agent context
  const planWords = /创建|制定|生成|新建|章节|一天|几天|两个|一起/;
  const skipCache = planWords.test(input);

  // 1. 缓存查找
  if (!skipCache) {
    const cached = findCachedQuery(userInput, userId);
    if (cached) {
      logger.info({ intent: cached.intent, pattern: cached.pattern }, "[AQC] 缓存命中");
      if (cached.intent === "create_quiz") {
        // create_quiz 指令不由 executeOperation 处理，直接从缓存重建 directive
        logger.info({ params: cached.params_json }, "[AQC] create_quiz 缓存重建");
        return `__CREATE_QUIZ__:${cached.params_json}`;
      }
      const result = await executeOperation(userId, JSON.parse(cached.operation_json));
      if (result !== null) return result;
      logger.warn({ cachedId: cached.id }, "[AQC] 缓存执行失败，删除");
      deleteCachedQuery(cached.id);
    } else {
      logger.info("[AQC] 缓存未命中");
    }
  }

  // 2. 意图分类（LLM）
  logger.info("[AQC] 调用 LLM 进行意图分类");
  const intentResult = await classifyIntent(userInput, userId, assistantName);
  if (!intentResult || intentResult.intent === "chat") {
    logger.info("[AQC] 意图分类结果为 chat，放行至 Agent");
    return null;
  }
  logger.info({ intent: intentResult.intent, params: intentResult.params }, "[AQC] 意图分类命中");

  // 3. create_quiz 特殊处理：返回指令标记，由 http.ts 转发给 Agent
  if (intentResult.intent === "create_quiz") {
    const directive = `__CREATE_QUIZ__:${JSON.stringify(intentResult.params)}`;
    logger.info({ params: intentResult.params }, "[AQC] create_quiz 意图，构造 Agent 指令");
    return directive;
  }

  // 4. 执行操作
  const reply = await executeOperation(userId, intentResult.operation);
  if (reply === null) return null;

  // 5. 缓存结果（用户层）
  try {
    insertCachedQuery(
      userInput, intentResult.intent,
      JSON.stringify(intentResult.params),
      JSON.stringify(intentResult.operation),
      userId,
    );
  } catch { /* ignore */ }

  logger.info({ intent: intentResult.intent, replyLen: reply.length }, "[AQC] 直接返回");
  return reply;
}

/**
 * 调用 LLM 进行意图分类
 */
async function classifyIntent(
  userInput: string, userId: number, assistantName: string,
): Promise<QueryResult | null> {
  const systemPrompt = `You are an intent classifier. Classify the user's input into one of the available query capabilities below.

Available capabilities:
- getStudyStats(userId): Get user study stats (overall mastery, weakest knowledge points)
- getWrongQuestions(userId, subject?): Get user's wrong questions list
- getDueReviews(userId): Get today's due spaced repetition reviews
- getStudyPlan(userId): Get current study plan and progress
- createQuiz(userId, subject, knowledge_point?, question_count?, test_level?): Create a quiz directly

If the user asks to create a quiz, take a test, or similar request, return createQuiz intent with the extracted params.

If the user input does NOT match any capability (e.g. chatting, requesting explanations, generating content), return {"intent":"chat"}.

Otherwise, return a JSON object exactly like:
{"intent":"query_study_stats","params":{},"operation":{"action":"getStudyStats","params":{"userId":USERID}}}

For createQuiz, use {"intent":"create_quiz","params":{"subject":"数学","knowledge_point":"二次函数","question_count":10,"test_level":1},"operation":{"action":"create_quiz","params":{"subject":"数学","knowledge_point":"二次函数","question_count":10,"test_level":1}}}

Replace USERID with the actual value: ${userId}.

Rules:
- For getWrongQuestions, if the user mentions a subject (e.g. "数学错题"), include "subjectName" in params
- Output ONLY the JSON object, no markdown fences, no other text.`;

  try {
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userInput },
    ];
    const result = await nonStreamingApiCall(messages, [], {
      name: MODEL_NAME, baseUrl: MODEL_BASE_URL, apiKey: MODEL_API_KEY,
    });

    if (!result.content) return null;
    const text = result.content.trim();
    // Strip possible markdown fences
    const jsonStr = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr) as { intent: string; params: Record<string, unknown>; operation: { action: string; params: Record<string, unknown> } };
    if (!parsed.intent || !parsed.operation?.action) return null;
    const queryResult: QueryResult = { intent: parsed.intent, params: parsed.params || {}, operation: parsed.operation };
    // create_quiz 走 Agent 路径（__CREATE_QUIZ__ 指令），不缓存到 AQC 缓存
    // 缓存中的 create_quiz 条目会被 routeViaCache 尝试 executeOperation 导致失败
    if (queryResult.intent !== "create_quiz") {
      try {
        insertCachedQuery(
          userInput, queryResult.intent,
          JSON.stringify(queryResult.params),
          JSON.stringify(queryResult.operation),
        );
      } catch { /* ignore */ }
    }
    return queryResult;
  } catch {
    return null;
  }
}

/**
 * 根据 operation 执行对应的数据库查询并格式化返回文本
 */
async function executeOperation(
  userId: number, operation: { action: string; params: Record<string, unknown> },
): Promise<string | null> {
  try {
    const { action, params } = operation;

    switch (action) {
      case "getStudyStats": {
        const subjectName = params.subjectName as string | undefined;
        let subjectId: number | undefined;
        if (subjectName) {
          const s = getSubjectByName(subjectName);
          if (s) subjectId = s.id;
        }
        const stats = getStudyStats(userId, subjectId);
        const accuracy = stats.total_answers > 0
          ? Math.round((stats.correct_answers / stats.total_answers) * 100)
          : 0;
        const lines = [`Study Stats: ${stats.total_quizzes} quizzes, ${stats.total_answers} answers (${accuracy}% accuracy)`];
        lines.push(`Wrong questions: ${stats.active_wrong_questions} active, ${stats.mastered_questions} mastered`);
        lines.push(`Reviews due now: ${stats.due_reviews}`);
        return lines.join("\n");
      }

      case "getWrongQuestions": {
        const subjectName = params.subjectName as string | undefined;
        let subjectId: number | undefined;
        if (subjectName) {
          const s = getSubjectByName(subjectName);
          if (s) subjectId = s.id;
        }
        const wrong = getWrongQuestionsBySubject(userId, subjectId);
        if (wrong.length === 0) return "No wrong questions. Great job!";
        const lines = [`${wrong.length} wrong question(s):`];
        for (let i = 0; i < Math.min(wrong.length, 5); i++) {
          const w = wrong[i];
          lines.push(`${i + 1}. ${w.question_text.substring(0, 100)} (wrong ${w.wrong_count}x${w.mastered ? ", mastered" : ""})`);
        }
        return lines.join("\n");
      }

      case "getDueReviews": {
        const subjectName = params.subjectName as string | undefined;
        let subjectId: number | undefined;
        if (subjectName) {
          const s = getSubjectByName(subjectName);
          if (s) subjectId = s.id;
        }
        const due = getDueReviews(userId, subjectId);
        if (due.length === 0) return "No reviews due. Great job!";
        const lines = [`${due.length} review(s) due today:`];
        for (let i = 0; i < Math.min(due.length, 5); i++) {
          const d = due[i];
          lines.push(`${i + 1}. [Wrong ${d.wrong_count}x] ${d.question_text.substring(0, 100)}`);
        }
        return lines.join("\n");
      }

      case "getStudyPlan": {
        const plan = getActiveStudyPlan(userId);
        if (!plan) return "No active study plan. Ask Domiclaw to create one.";
        const progress = getStudyPlanProgress(plan.id);
        if (!progress) return "Error reading plan.";
        const bar = renderProgressBar(progress.percent);
        const lines = [`${plan.title}: ${progress.completed}/${progress.total} ${bar}`];
        if (progress.upcoming.length > 0) {
          lines.push("Upcoming:");
          for (const t of progress.upcoming.slice(0, 3)) {
            lines.push(`  Day ${t.day} (${t.date}): ${t.task}`);
          }
        }
        return lines.join("\n");
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}


// ── Card Command (画布操作统一指令) ──

/**
 * 解析 __CARD__:tool_name:key=value:... 格式的指令
 */
export function parseCardCommand(text: string): { toolName: string; params: Record<string, unknown> } | null {
  if (!text.startsWith("__CARD__:")) return null;
  const inner = text.slice("__CARD__:".length);
  if (!inner) return null;
  const pairs = inner.split(":");
  const toolName = pairs[0];
  if (!toolName) return null;

  const params: Record<string, unknown> = {};
  for (let i = 1; i < pairs.length; i++) {
    const eqIdx = pairs[i].indexOf("=");
    if (eqIdx <= 0) continue;
    const key = pairs[i].slice(0, eqIdx);
    let value: string | number = pairs[i].slice(eqIdx + 1).replace(/^"|"$/g, "");
    if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
    params[key] = value;
  }
  return { toolName, params };
}

/**
 * 处理画布卡片指令：解析 → 直接执行工具 → 返回友好提示
 */
async function handleCardCommand(
  text: string, userId: number,
): Promise<string | null> {
  const parsed = parseCardCommand(text);
  if (!parsed) return null;

  logger.info({ tool: parsed.toolName, params: parsed.params }, "[CARD] 画布指令解析");

  const tool = getTool(parsed.toolName);
  if (!tool) {
    const names = getAllToolDefinitions().map(t => t.function.name).join(", ");
    return `Error: unknown tool "${parsed.toolName}". Available: ${names}`;
  }

  const ctx: ToolContext = { workspaceDir: "", userId };
  const result = await tool.execute(parsed.params, ctx);

  logger.info({ tool: parsed.toolName, resultLen: result.length }, "[CARD] 工具执行完成");
  return result;
}
