import { registerTool } from "./index.js";
import {
  addExamPaper,
  addKnowledgePoint,
  addQuestion,
  getAllSubjects,
  getSubjectByName,
  searchKnowledgePoints,
} from "../db.js";

registerTool("add_knowledge_point", {
  definition: {
    type: "function",
    function: {
      name: "add_knowledge_point",
      description: "Add a knowledge point (topic) for a subject. Store explanations, formulas, concepts.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Subject name (e.g. Mathematics)" },
          title: { type: "string", description: "Title of the knowledge point" },
          content: { type: "string", description: "Detailed content/explanation" },
          tags: { type: "string", description: "Optional comma-separated tags" },
        },
        required: ["subject", "title", "content"],
      },
    },
  },
  async execute(args) {
    const subjectName = args.subject as string;
    const title = args.title as string;
    const content = args.content as string;
    const tags = args.tags as string | undefined;

    const subject = getSubjectByName(subjectName);
    if (!subject) {
      const subjects = getAllSubjects().map((s) => s.name).join(", ");
      return `Subject "${subjectName}" not found. Available subjects: ${subjects}`;
    }

    const id = addKnowledgePoint(subject.id, title, content, tags);
    return `Knowledge point added (ID: ${id}). Subject: ${subjectName}, Title: ${title}`;
  },
});

registerTool("search_knowledge", {
  definition: {
    type: "function",
    function: {
      name: "search_knowledge",
      description: "Search stored knowledge points by keyword. Returns matching topics with content.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword" },
          subject: { type: "string", description: "Optional: limit to a specific subject" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = args.query as string;
    const subjectName = args.subject as string | undefined;

    let subjectId: number | undefined;
    if (subjectName) {
      const subject = getSubjectByName(subjectName);
      if (!subject) return `Subject "${subjectName}" not found.`;
      subjectId = subject.id;
    }

    const results = searchKnowledgePoints(query, subjectId);
    if (results.length === 0) return `No knowledge points found for "${query}".`;

    return results
      .map(
        (kp, i) =>
          `${i + 1}. [${kp.title}] ${kp.content.substring(0, 300)}${kp.content.length > 300 ? "..." : ""}${kp.tags ? ` (tags: ${kp.tags})` : ""}`,
      )
      .join("\n\n");
  },
});

registerTool("add_exam_paper", {
  definition: {
    type: "function",
    function: {
      name: "add_exam_paper",
      description: "Store an exam paper with questions. Questions are stored and can be used in quizzes.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Subject name" },
          title: { type: "string", description: "Exam paper title (e.g. '2024 Midterm')" },
          exam_date: { type: "string", description: "Optional exam date (ISO format)" },
          total_score: { type: "number", description: "Total score (default 100)" },
          duration_minutes: { type: "number", description: "Duration in minutes (default 60)" },
          questions: {
            type: "array",
            description: "Array of question objects",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "Question text" },
                answer: { type: "string", description: "Correct answer" },
                explanation: { type: "string", description: "Optional explanation" },
                type: { type: "string", description: "Question type: multiple_choice, short_answer, or essay" },
                options: { type: "string", description: "For multiple_choice: JSON like {\"A\":\"...\",\"B\":\"...\"}" },
                difficulty: { type: "number", description: "Difficulty 1-5 (default 1)" },
                knowledge_point: { type: "string", description: "Optional knowledge point title to link to" },
              },
              required: ["text", "answer"],
            },
          },
        },
        required: ["subject", "title", "questions"],
      },
    },
  },
  async execute(args) {
    const subjectName = args.subject as string;
    const title = args.title as string;
    const examDate = args.exam_date as string | undefined;
    const totalScore = args.total_score as number | undefined;
    const durationMinutes = args.duration_minutes as number | undefined;
    const questions = args.questions as Array<{
      text: string;
      answer: string;
      explanation?: string;
      type?: string;
      options?: string;
      difficulty?: number;
      knowledge_point?: string;
    }>;

    const subject = getSubjectByName(subjectName);
    if (!subject) return `Subject "${subjectName}" not found.`;

    const paperId = addExamPaper(subject.id, title, examDate, totalScore, durationMinutes);

    let addedCount = 0;
    for (const q of questions) {
      let kpId: number | null = null;
      if (q.knowledge_point) {
        const results = searchKnowledgePoints(q.knowledge_point, subject.id);
        if (results.length > 0) kpId = results[0].id;
      }
      addQuestion(paperId, kpId, q.text, q.answer, q.type || "short_answer", q.explanation, q.difficulty, q.options);
      addedCount++;
    }

    return `Exam paper "${title}" added (ID: ${paperId}). Subject: ${subjectName}, Questions: ${addedCount}`;
  },
});

registerTool("import_questions", {
  definition: {
    type: "function",
    function: {
      name: "import_questions",
      description: "Bulk import questions for a subject. Questions are stored directly without an exam paper.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Subject name" },
          questions: {
            type: "array",
            description: "Array of question objects",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "Question text" },
                answer: { type: "string", description: "Correct answer" },
                explanation: { type: "string", description: "Optional explanation" },
                type: { type: "string", description: "short_answer, multiple_choice, or essay" },
                options: { type: "string", description: "For multiple_choice: JSON options" },
                difficulty: { type: "number", description: "1-5" },
                knowledge_point: { type: "string", description: "Knowledge point title to link" },
              },
              required: ["text", "answer"],
            },
          },
        },
        required: ["subject", "questions"],
      },
    },
  },
  async execute(args) {
    const subjectName = args.subject as string;
    const questions = args.questions as Array<{
      text: string; answer: string; explanation?: string;
      type?: string; options?: string; difficulty?: number; knowledge_point?: string;
    }>;

    const subject = getSubjectByName(subjectName);
    if (!subject) return `Subject "${subjectName}" not found.`;

    let imported = 0;
    for (const q of questions) {
      let kpId: number | null = null;
      if (q.knowledge_point) {
        const results = searchKnowledgePoints(q.knowledge_point, subject.id);
        if (results.length > 0) kpId = results[0].id;
      }
      addQuestion(null, kpId, q.text, q.answer, q.type || "short_answer", q.explanation, q.difficulty, q.options);
      imported++;
    }

    return `Imported ${imported} question(s) for ${subjectName}. They are now available for quizzes.`;
  },
});
