import { registerTool } from "./index.js";
import {
  createQuizSession,
  getAllSubjects,
  getQuestionById,
  getQuestionsBySubject,
  getQuizSessionAnswers,
  getSubjectByName,
  getWrongQuestionsBySubject,
  recordQuizAnswer,
  recordWrongQuestion,
  searchKnowledgePoints,
} from "../db.js";

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
      description: "Create a new quiz session for a student on a subject. Returns quiz intro and first question.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Subject name (e.g. Mathematics, Physics)" },
          question_count: { type: "number", description: "Number of questions (default 5)" },
          knowledge_point: { type: "string", description: "Optional: filter by knowledge point title" },
        },
        required: ["subject"],
      },
    },
  },
  async execute(args, ctx) {
    const subjectName = args.subject as string;
    const questionCount = (args.question_count as number) || 5;
    const kpFilter = args.knowledge_point as string | undefined;

    const subject = getSubjectByName(subjectName);
    if (!subject) {
      const names = getAllSubjects().map((s) => s.name).join(", ");
      return `Subject "${subjectName}" not found. Available: ${names}`;
    }

    let questions = getQuestionsBySubject(subject.id, 200);

    if (kpFilter) {
      questions = questions.filter((q) => {
        if (!q.knowledge_point_id) return false;
        return q.question_text.toLowerCase().includes(kpFilter.toLowerCase());
      });
    }

    if (questions.length === 0) {
      return `No questions found for "${subjectName}". Add some with add_exam_paper or add_knowledge_point first.`;
    }

    // Select random questions
    const selected = questions.sort(() => Math.random() - 0.5).slice(0, Math.min(questionCount, questions.length));
    const sessionId = createQuizSession(subject.id, ctx.chatJid);

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
      description: "Record a student's answer to a quiz question. Returns whether correct, explanation, and next question or quiz summary.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "number", description: "Quiz session ID" },
          question_id: { type: "number", description: "Question ID being answered" },
          answer: { type: "string", description: "Student's answer" },
        },
        required: ["session_id", "question_id", "answer"],
      },
    },
  },
  async execute(args, ctx) {
    const sessionId = args.session_id as number;
    const questionId = args.question_id as number;
    const studentAnswer = args.answer as string;

    const question = getQuestionById(questionId);
    if (!question) return `Question ${questionId} not found.`;

    const correct = checkAnswer(studentAnswer, question.answer, question.question_type);
    recordQuizAnswer(sessionId, questionId, studentAnswer, correct);

    if (!correct) {
      recordWrongQuestion(questionId, ctx.chatJid);
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
      description: "Export the student's wrong questions as formatted text for printing or review.",
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
    const wrong = getWrongQuestionsBySubject(ctx.chatJid, subjectId);
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
    out += `Active: ${wrong.filter(w => !w.mastered).length} | Mastered: ${wrong.filter(w => w.mastered).length}\n`;

    return out;
  },
});

function formatQuestion(
  num: number,
  total: number,
  q: { id: number; question_text: string; question_type: string; options: string | null },
): string {
  let out = `Q${num}/${total} (ID: ${q.id}) [${q.question_type}]: ${q.question_text}\n`;
  if (q.options) {
    try {
      const opts = JSON.parse(q.options) as Record<string, string>;
      for (const [k, v] of Object.entries(opts)) {
        out += `  ${k}: ${v}\n`;
      }
    } catch {
      out += `  Options: ${q.options}\n`;
    }
  }
  return out;
}
