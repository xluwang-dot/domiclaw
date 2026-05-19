/**
 * 自适应查询缓存层（AQC）
 *
 * 对用户的查询类问题，优先从缓存查找匹配的查询方案并执行。
 * 缓存未命中时调用一次轻量 LLM 分类，执行后自动缓存。
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
  const input = userInput.trim().toLowerCase();

  // Skip cache for plan/creation conversations — follow-up messages need Agent context
  const planWords = /创建|制定|生成|新建|章节|一天|几天|两个|一起/;
  const skipCache = planWords.test(input);

  // 1. 缓存查找
  if (!skipCache) {
    const cached = findCachedQuery(userInput, userId);
    if (cached) {
      logger.info({ intent: cached.intent, pattern: cached.pattern }, "[AQC] 缓存命中");
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
    try {
      insertCachedQuery(
        userInput, queryResult.intent,
        JSON.stringify(queryResult.params),
        JSON.stringify(queryResult.operation),
      );
    } catch { /* ignore */ }
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
        const bar = renderBar(progress.percent);
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

function renderBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "[" + "\u2588".repeat(filled) + "\u2591".repeat(10 - filled) + `] ${pct}%`;
}
