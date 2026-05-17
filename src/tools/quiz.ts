import { registerTool } from "./index.js";
import {
  createQuizSession,
  getAllSubjects,
  getDatabase,
  getKnowledgePointById,
  getQuestionById,
  getQuestionsBySubject,
  getQuizSessionAnswers,
  getSubjectByName,
  getWrongQuestionsBySubject,
  recordQuizAnswer,
  recordWrongQuestion,
  searchKnowledgePoints,
  updateNotebook,
  setWrongQuestionRootKp,
  notebookAddWrong,
  notebookClearWeakness,
  getAllDescendantKpIds,
  updateQuestionStats,
  getQuestionDifficulty,
  getTestLevelConfig,
} from "../db.js";

/**
 * 检查学生答案是否正确
 * @param studentAnswer 学生答案
 * @param correctAnswer 正确答案
 * @param questionType 问题类型
 * @returns 是否正确
 */
function checkAnswer(studentAnswer: string, correctAnswer: string, questionType: string): boolean {
  const sa = studentAnswer.trim().toLowerCase();
  const ca = correctAnswer.trim().toLowerCase();
  if (questionType === "multiple_choice") return sa === ca;
  return sa.includes(ca) || ca.includes(sa);
}

registerTool("create_quiz", {
  definition: {
    type: "function",
    function: {
      name: "create_quiz",
      description: "创建一个新的测验会话，返回测验介绍和第一个问题",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名称（例如：数学、物理）" },
          question_count: { type: "number", description: "问题数量（默认5个）" },
          knowledge_point: { type: "string", description: "可选：按知识点标题筛选" },
          min_difficulty: { type: "number", description: "可选：最低难度（0-1），只返回难度不低于此值的题目" },
          max_difficulty: { type: "number", description: "可选：最高难度（0-1），只返回难度不高于此值的题目" },
          test_level: { type: "number", description: "可选：测试等级（1/2/3），按预设难度分布出题，会覆盖 question_count" },
        },
        required: ["subject"],
      },
    },
  },
  async execute(args, ctx) {
    const subjectName = args.subject as string;
    let questionCount = (args.question_count as number) || 5;
    const kpFilter = args.knowledge_point as string | undefined;
    const testLevel = args.test_level as number | undefined;

    // 按测试等级覆盖题目数量和难度分布
    if (testLevel !== undefined) {
      const cfg = getTestLevelConfig(testLevel);
      if (!cfg) {
        return `Invalid test_level "${testLevel}". Available: 1, 2, 3.`;
      }
      questionCount = cfg.question_count;
    }

    const subject = getSubjectByName(subjectName);
    if (!subject) {
      const names = getAllSubjects().map((s) => s.name).join(", ");
      return `Subject "${subjectName}" not found. Available: ${names}`;
    }

    let questions: any[] = [];
    if (kpFilter) {
      // 搜索指定知识点
      const kpResults = searchKnowledgePoints(kpFilter, subject.id);
      if (kpResults.length === 0) {
        return `Knowledge point "${kpFilter}" not found in subject "${subjectName}".`;
      }
      
      // 获取所有子知识点ID
      const kpIds = new Set<number>();
      for (const kp of kpResults) {
        const descendantIds = getAllDescendantKpIds(kp.id);
        descendantIds.forEach(id => kpIds.add(id));
      }
      
      if (kpIds.size === 0) {
        return `No knowledge points found for "${kpFilter}".`;
      }
      
      // 查询指定知识点及其子知识点关联的题目
      const kpIdArray = Array.from(kpIds);
      const placeholders = kpIdArray.map(() => "?").join(",");
      
      questions = getDatabase().prepare(`
        SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type,
               q.options, q.knowledge_point_id, q.knowledge_point_ids
        FROM questions q
        WHERE (q.knowledge_point_id IN (${placeholders}) 
               OR q.knowledge_point_ids LIKE '%' || ? || '%')
        AND q.status = 'published'
      `).all(...kpIdArray, kpFilter.toLowerCase());
    } else {
      // 默认行为：获取科目下的所有题目
      questions = getQuestionsBySubject(subject.id, 200);
    }

    if (kpFilter) {
      questions = questions.filter((q) => {
        if (!q.knowledge_point_id) return false;
        return q.question_text.toLowerCase().includes(kpFilter.toLowerCase());
      });
    }

    // 按难度筛选
    const minDiff = args.min_difficulty as number | undefined;
    const maxDiff = args.max_difficulty as number | undefined;
    if (minDiff !== undefined || maxDiff !== undefined) {
      questions = questions.filter((q) => {
        const d = getQuestionDifficulty(q.id);
        if (minDiff !== undefined && d < minDiff) return false;
        if (maxDiff !== undefined && d > maxDiff) return false;
        return true;
      });
    }

    if (questions.length === 0) {
      return `No questions found for "${subjectName}". Add some with add_knowledge_point first.`;
    }

    // Select random questions
    let selected: any[];
    if (testLevel !== undefined) {
      // 按等级按难度分层抽题
      const cfg = getTestLevelConfig(testLevel)!;
      const ratios = [cfg.easy_ratio, cfg.medium_ratio, cfg.hard_ratio];
      const diffValues = [testLevel, testLevel + 1, testLevel + 2];
      const pool: any[] = [];

      for (let i = 0; i < 3; i++) {
        const diff = diffValues[i];
        const ratio = ratios[i];
        const count = i < 2
          ? Math.round(questionCount * ratio)
          : questionCount - pool.length;

        const bucket = questions
          .filter((q) => q.difficulty === diff)
          .sort(() => Math.random() - 0.5)
          .slice(0, count);

        pool.push(...bucket);
      }

      selected = pool.sort(() => Math.random() - 0.5);
    } else {
      selected = questions.sort(() => Math.random() - 0.5).slice(0, Math.min(questionCount, questions.length));
    }
    const sessionId = createQuizSession(subject.id, ctx.userId);

    // Return the full quiz with all questions
    let response = `Quiz started! Subject: ${subjectName}, Session ID: ${sessionId}, Questions: ${selected.length}\n\n`;
    for (let i = 0; i < selected.length; i++) {
      response += formatQuestion(i + 1, selected.length, selected[i]);
      if (i < selected.length - 1) response += "\n";
    }
    response += `\nUse record_answer with session_id=${sessionId} and the question ID to submit each answer.`;

    return response;
  },
});

registerTool("record_answer", {
  definition: {
    type: "function",
    function: {
      name: "record_answer",
      description: "记录学生对测验问题的答案，返回是否正确、解释以及下一个问题或测验总结",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "number", description: "测验会话ID" },
          question_id: { type: "number", description: "正在回答的问题ID" },
          answer: { type: "string", description: "学生答案" },
        },
        required: ["session_id", "question_id", "answer"],
      },
    },
  },
  async execute(args, ctx) {
    const sessionId = args.session_id as number;
    const questionId = args.question_id as number;
    const studentAnswer = args.answer as string;
    const userId = ctx.userId;

    const question = getQuestionById(questionId);
    if (!question) return `Question ${questionId} not found.`;

    const correct = checkAnswer(studentAnswer, question.answer, question.question_type);
    updateQuestionStats(questionId, correct);

    // Determine subject_id from the primary KP
    let subjectId = 0;
    const kpIds: number[] = [];
    if (question.knowledge_point_id) {
      kpIds.push(question.knowledge_point_id);
      const kp = getKnowledgePointById(question.knowledge_point_id);
      if (kp) subjectId = kp.subject_id;
    }

    recordQuizAnswer(sessionId, subjectId, questionId, studentAnswer, correct, correct ? undefined : kpIds);

    if (!correct) {
      recordWrongQuestion(questionId, userId, subjectId);
      for (const kpId of kpIds) {
        setWrongQuestionRootKp(questionId, userId, kpId);
        updateNotebook(userId, subjectId, kpId, false);
        notebookAddWrong(userId, subjectId, kpId, questionId);
      }
    } else {
      for (const kpId of kpIds) {
        updateNotebook(userId, subjectId, kpId, true);
        notebookClearWeakness(userId, subjectId, kpId);
      }
    }

    const answered = getQuizSessionAnswers(sessionId);

    const correctStr = correct ? "CORRECT" : "INCORRECT";
    let response = `${correctStr}\n`;
    if (question.explanation) response += `Explanation: ${question.explanation}\n`;
    response += `\n(Answered ${answered.length} questions so far.)`;

    return response;
  },
});

registerTool("export_wrong_questions", {
  definition: {
    type: "function",
    function: {
      name: "export_wrong_questions",
      description: "导出学生的错题作为格式化文本，用于打印或复习",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "可选：按科目名称筛选" },
        },
        required: [],
      },
    },
  },
  async execute(args, ctx) {
    const subjectName = args.subject as string | undefined;
    let subjectId: number | undefined;
    if (subjectName) {
      const s = getSubjectByName(subjectName);
      if (!s) return `Subject "${subjectName}" not found.`;
      subjectId = s.id;
    }
    const wrong = getWrongQuestionsBySubject(ctx.userId, subjectId);
    if (wrong.length === 0) return "No wrong questions to export. Great job!";

    const header = "Wrong Questions Export";
    const date = new Date().toLocaleDateString();
    const subjectLine = subjectName ? `Subject: ${subjectName}` : "All subjects";

    let out = `${header}\n${date}\n${subjectLine}\n${"=".repeat(40)}\n\n`;
    for (let i = 0; i < wrong.length; i++) {
      const w = wrong[i];
      out += `Q${i + 1}. [${w.subject_name}] ${w.question_text}\n`;
      out += `    Answer: ${w.answer}\n`;
      out += `    Wrong ${w.wrong_count}x | Status: ${w.mastered ? "Mastered" : "Active"}\n\n`;
    }
    out += `${"=".repeat(40)}\n`;
    out += `Total: ${wrong.length} wrong question(s)\n`;
    out += `Active: ${wrong.filter(w => !w.mastered).length} | Mastered: ${wrong.filter(w => w.mastered).length}`;

    return out;
  },
});

/**
 * 格式化问题显示
 * @param num 问题序号
 * @param total 总问题数
 * @param q 问题对象
 * @returns 格式化后的字符串
 */
function formatQuestion(
  num: number,
  total: number,
  q: { id: number; question_text: string; question_type: string; options: string | null },
): string {
  let out = `Q${num}/${total} (ID: ${q.id}) [${q.question_type}]: ${q.question_text}\n`;
  if (q.options) {
    try {
      const parsed = JSON.parse(q.options);
      if (Array.isArray(parsed)) {
        const letters = "ABCDEFGHIJ";
        for (let i = 0; i < parsed.length; i++) {
          out += `  ${letters[i] || i}: ${parsed[i]}\n`;
        }
      } else {
        for (const [k, v] of Object.entries(parsed as Record<string, string>)) {
          out += `  ${k}: ${v}\n`;
        }
      }
    } catch {
      out += `  Options: ${q.options}\n`;
    }
  }
  return out;
}
