import { registerTool } from "./index.js";
import {
  getDueReviews,
  getQuestionById,
  getStudyStats,
  getSubjectByName,
  getWrongQuestionsBySubject,
  updateReviewResult,
  recordWrongQuestion,
} from "../db.js";

registerTool("get_due_reviews", {
  definition: {
    type: "function",
    function: {
      name: "get_due_reviews",
      description: "Get questions due for spaced repetition review. Returns questions the student should re-test on today.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Optional: filter by subject name" },
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

    const due = getDueReviews(ctx.chatJid, subjectId);

    if (due.length === 0) {
      return "No questions due for review right now. Great job staying on top of things!";
    }

    const lines = due.map(
      (wq, i) =>
        `${i + 1}. [Wrong ${wq.wrong_count}x, Interval: ${wq.review_interval_days}d] (ID: ${wq.question_id}, Review ID: ${wq.id}) ${wq.question_text.substring(0, 200)}`,
    );

    return `You have ${due.length} question(s) due for review:\n\n${lines.join("\n\n")}\n\nUse review_answer with the Review ID to submit your answer for each one.`;
  },
});

registerTool("review_answer", {
  definition: {
    type: "function",
    function: {
      name: "review_answer",
      description: "Submit an answer for a spaced repetition review question. Updates the review schedule based on correctness.",
      parameters: {
        type: "object",
        properties: {
          wrong_question_id: { type: "number", description: "The wrong_question review ID (from get_due_reviews)" },
          answer: { type: "string", description: "Student's answer" },
        },
        required: ["wrong_question_id", "answer"],
      },
    },
  },
  async execute(args, ctx) {
    const wqId = args.wrong_question_id as number;
    const studentAnswer = args.answer as string;

    // Get the question through due reviews — we need the question_id from wrong_questions
    const due = getDueReviews(ctx.chatJid);
    const match = due.find((d) => d.id === wqId);
    if (!match) {
      // Try to find it even if not due
      const question = getQuestionById(wqId);
      if (!question) return `Review ID ${wqId} not found. Use get_due_reviews to see available reviews.`;
    }

    const question = getQuestionById(match ? match.question_id : wqId);
    if (!question) return `Question not found for review ID ${wqId}.`;

    const sa = studentAnswer.trim().toLowerCase();
    const ca = question.answer.trim().toLowerCase();
    const correct =
      question.question_type === "multiple_choice"
        ? sa === ca
        : sa.includes(ca) || ca.includes(sa);

    const result = updateReviewResult(wqId, correct);

    let response = correct ? "CORRECT!" : "INCORRECT";
    if (question.explanation) response += `\nExplanation: ${question.explanation}`;
    if (correct) {
      response += `\nConsecutive correct: ${result.consecutive_correct}`;
      if (result.mastered) response += "\nThis question is now mastered!";
      response += `\nNext review: ${result.next_review_at}`;
    } else {
      response += "\nReset to 1-day interval. Keep practicing!";
      // Re-record as wrong to update tracking
      recordWrongQuestion(question.id, ctx.chatJid);
    }

    return response;
  },
});

registerTool("get_study_stats", {
  definition: {
    type: "function",
    function: {
      name: "get_study_stats",
      description: "Get study statistics: total quizzes, accuracy, wrong questions, due reviews.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Optional: filter by subject" },
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

    const stats = getStudyStats(ctx.chatJid, subjectId);
    const accuracy = stats.total_answers > 0
      ? Math.round((stats.correct_answers / stats.total_answers) * 100)
      : 0;

    let response = "Study Statistics";
    if (subjectName) response += ` for ${subjectName}`;
    response += `:
- Total quizzes: ${stats.total_quizzes}
- Total answers: ${stats.total_answers}
- Accuracy: ${accuracy}%
- Active wrong questions: ${stats.active_wrong_questions}
- Mastered questions: ${stats.mastered_questions}
- Reviews due now: ${stats.due_reviews}`;

    // Also show wrong questions by subject if no subject filter
    if (!subjectId) {
      const wrong = getWrongQuestionsBySubject(ctx.chatJid);
      if (wrong.length > 0) {
        const bySubject = new Map<string, number>();
        for (const w of wrong) {
          if (!w.mastered) {
            bySubject.set(w.subject_name, (bySubject.get(w.subject_name) || 0) + 1);
          }
        }
        if (bySubject.size > 0) {
          response += "\n\nWeak areas:";
          for (const [subj, count] of [...bySubject.entries()].sort((a, b) => b[1] - a[1])) {
            response += `\n  ${subj}: ${count} active wrong question(s)`;
          }
        }
      }
    }

    return response;
  },
});
