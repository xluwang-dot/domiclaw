import { registerTool } from "./index.js";
import {
  getDueReviews,
  getQuestionById,
  getStudyStats,
  getSubjectByName,
  getWrongQuestionsBySubject,
  updateReviewResult,
  recordWrongQuestion,
  getNotebookWeakKps,
  getNotebookStats,
  getKnowledgePointById,
  getQuestionsByKnowledgePoint,
  updateQuestionStats,
} from "../db.js";

registerTool("get_due_reviews", {
  definition: {
    type: "function",
    function: {
      name: "get_due_reviews",
      description:
        "获取待复习的间隔重复问题，以及薄弱知识点的抽查复习。返回SM-2到期问题和掌握度<0.6的知识点的2-3个随机问题",
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

    const due = getDueReviews(ctx.userId, subjectId);

    // --- Weak KP spot-check reviews ---
    const weakKps = getNotebookWeakKps(ctx.userId);
    const weakKpReviews: {
      kp_id: number;
      kp_name: string;
      mastery: number;
      total_wrong: number;
      questions: { id: number; text: string; type: string }[];
    }[] = [];

    for (const wk of weakKps) {
      if (wk.mastery >= 0.6) continue;
      const allQ = getQuestionsByKnowledgePoint(wk.kp_id);
      const selected = allQ
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      if (selected.length > 0) {
        weakKpReviews.push({
          kp_id: wk.kp_id,
          kp_name: wk.kp_name,
          mastery: wk.mastery,
          total_wrong: wk.total_wrong,
          questions: selected.map((q) => ({
            id: q.id,
            text: q.question_text.substring(0, 200),
            type: q.question_type,
          })),
        });
      }
    }

    // --- Build response ---
    const parts: string[] = [];

    if (due.length === 0) {
      parts.push("No SM-2 reviews due right now.");
    } else {
      parts.push(`You have ${due.length} SM-2 review(s) due:`);
      const lines = due.map(
        (wq, i) =>
          `${i + 1}. [Wrong ${wq.wrong_count}x, Interval: ${wq.review_interval_days}d] ` +
          `(Q-ID: ${wq.question_id}, Review ID: ${wq.id}) ${wq.question_text.substring(0, 200)}`,
      );
      parts.push(lines.join("\n\n"));
    }

    if (weakKpReviews.length > 0) {
      parts.push(`\n--- KP Spot-Check Reviews (mastery < 0.6) ---`);
      for (const wk of weakKpReviews) {
        parts.push(
          `\nKP: ${wk.kp_name} (mastery: ${wk.mastery}, wrong ${wk.total_wrong}x)`,
        );
        for (let i = 0; i < wk.questions.length; i++) {
          const q = wk.questions[i];
          parts.push(`  Q${i + 1}. (ID: ${q.id}) [${q.type}] ${q.text}`);
        }
      }
      parts.push(
        `\nUse record_answer with session_id=0 (spot-check) and the question ID. ` +
        `Or use review_answer with Review IDs for SM-2 items.`,
      );
    }

    if (due.length === 0 && weakKpReviews.length === 0) {
      return "No reviews or weak KP spot-checks due. Great job!";
    }

    return parts.join("\n");
  },
  metadata: { taskPhase: "pre", taskTypes: ["review"] },
});

registerTool("review_answer", {
  definition: {
    type: "function",
    function: {
      name: "review_answer",
      description: "提交间隔重复复习问题的答案，根据正确性更新复习计划",
      parameters: {
        type: "object",
        properties: {
          wrong_question_id: { type: "number", description: "错误的复习ID（来自get_due_reviews）" },
          answer: { type: "string", description: "学生答案" },
        },
        required: ["wrong_question_id", "answer"],
      },
    },
  },
  async execute(args, ctx) {
    const wqId = args.wrong_question_id as number;
    const studentAnswer = args.answer as string;

    const due = getDueReviews(ctx.userId);
    const match = due.find((d) => d.id === wqId);
    if (!match) {
      const question = getQuestionById(wqId);
      if (!question) return `Review ID ${wqId} not found. Use get_due_reviews to see available reviews.`;
    }

    const question = getQuestionById(match ? match.question_id : wqId);
    if (!question) return `Question not found for review ID ${wqId}.`;

    const sa = studentAnswer.trim().toLowerCase();
    const ca = question.answer.trim().toLowerCase();
    const correct =
      question.question_type === "multiple_choice"
        ? sa.charAt(0) === ca.charAt(0)
        : sa.includes(ca) || ca.includes(sa);
    updateQuestionStats(question.id, correct);

    const result = updateReviewResult(wqId, correct);

    let response = correct ? "CORRECT!" : "INCORRECT";
    if (question.explanation) response += `\nExplanation: ${question.explanation}`;
    if (correct) {
      response += `\nConsecutive correct: ${result.consecutive_correct}`;
      if (result.mastered) response += "\nThis question is now mastered!";
      response += `\nNext review: ${result.next_review_at}`;
    } else {
      response += "\nReset to 1-day interval. Keep practicing!";
      let subjId = 0;
      if (question.knowledge_point_id) {
        const kp = getKnowledgePointById(question.knowledge_point_id);
        if (kp) subjId = kp.subject_id;
      }
      recordWrongQuestion(question.id, ctx.userId, subjId);
    }

    return response;
  },
  metadata: { taskPhase: "during", taskTypes: ["review"] },
});

registerTool("get_study_stats", {
  definition: {
    type: "function",
    function: {
      name: "get_study_stats",
      description:
        "获取全面的学习统计：测验准确率、SM-2统计、整体知识点掌握度、前5个最薄弱知识点、弱点清理进度",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "可选：按科目筛选" },
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

    const stats = getStudyStats(ctx.userId, subjectId);
    const masteryStats = getNotebookStats(ctx.userId);

    const accuracy = stats.total_answers > 0
      ? Math.round((stats.correct_answers / stats.total_answers) * 100)
      : 0;

    const sections: string[] = [];

    // Quiz stats
    let section = "Study Statistics";
    if (subjectName) section += ` for ${subjectName}`;
    section += `:
- Total quizzes: ${stats.total_quizzes}
- Total answers: ${stats.total_answers}
- Accuracy: ${accuracy}%
- Active wrong questions: ${stats.active_wrong_questions}
- Mastered questions: ${stats.mastered_questions}
- Reviews due now: ${stats.due_reviews}`;
    sections.push(section);

    // Overall KP mastery
    sections.push(
      `\nKP Mastery:
- Overall average: ${masteryStats.avg_mastery} (${masteryStats.kp_count} KPs tracked)
- Weakness cleanup: ${masteryStats.weakness_cleared} cleared / ${masteryStats.weakness_total} total weak KPs`,
    );

    // Top 5 weakest KPs
    const weakKps = getNotebookWeakKps(ctx.userId);
    if (weakKps.length > 0) {
      const top5 = weakKps.slice(0, 5);
      sections.push("\nTop 5 Weakest Knowledge Points:");
      for (let i = 0; i < top5.length; i++) {
        const wk = top5[i];
        const kp = getKnowledgePointById(wk.kp_id);
        sections.push(
          `  ${i + 1}. ${kp?.title || `KP ${wk.kp_id}`} — mastery: ${wk.mastery}, wrong ${wk.total_wrong}x`,
        );
      }
    }

    // Weak areas by subject (existing)
    if (!subjectId) {
      const wrong = getWrongQuestionsBySubject(ctx.userId);
      if (wrong.length > 0) {
        const bySubject = new Map<string, number>();
        for (const w of wrong) {
          if (!w.mastered) {
            bySubject.set(w.subject_name, (bySubject.get(w.subject_name) || 0) + 1);
          }
        }
        if (bySubject.size > 0) {
          sections.push("\nWeak areas by subject:");
          for (const [subj, count] of [...bySubject.entries()].sort((a, b) => b[1] - a[1])) {
            sections.push(`  ${subj}: ${count} active wrong question(s)`);
          }
        }
      }
    }

    return sections.join("\n");
  },
  metadata: { taskPhase: "post", taskTypes: ["quiz", "review", "study"] },
});
