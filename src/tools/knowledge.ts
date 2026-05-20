import { registerTool } from "./index.js";
import {
  addKnowledgePoint,
  addQuestion,
  getAllSubjects,
  getSubjectByName,
  searchKnowledgePoints,
  generateKPEmbedding,
} from "../db.js";

registerTool("add_knowledge_point", {
  definition: {
    type: "function",
    function: {
      name: "add_knowledge_point",
      description: "为科目添加知识点（主题），存储解释、公式、概念等内容",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名称（例如：数学）" },
          title: { type: "string", description: "知识点标题" },
          content: { type: "string", description: "详细内容/解释" },
          alias: { type: "string", description: "可选的英文别名" },
          prerequisite_ids: { type: "string", description: "可选：前置知识点ID数组（JSON格式，如\"[1,2,3]\"），适用于自然科学" },
          related_ids: { type: "string", description: "可选：关联知识点ID数组（JSON格式，如\"[4,5,6]\"），适用于人文科学" },
        },
        required: ["subject", "title"],
      },
    },
  },
  async execute(args) {
    const subjectName = args.subject as string;
    const title = args.title as string;
    const content = (args.content as string) || "";
    const alias = args.alias as string | undefined;
    const prerequisiteIds = args.prerequisite_ids as string | undefined;
    const relatedIds = args.related_ids as string | undefined;

    const subject = getSubjectByName(subjectName);
    if (!subject) {
      const subjects = getAllSubjects().map((s) => s.name).join(", ");
      return `Subject "${subjectName}" not found. Available subjects: ${subjects}`;
    }

    const id = addKnowledgePoint(subject.id, title, content, undefined, undefined, undefined, alias, prerequisiteIds, relatedIds);
    generateKPEmbedding(id).catch(() => {});
    let msg = `Knowledge point added (ID: ${id}). Subject: ${subjectName}, Title: ${title}`;
    if (prerequisiteIds) msg += `\nPrerequisite IDs: ${prerequisiteIds}`;
    if (relatedIds) msg += `\nRelated IDs: ${relatedIds}`;
    return msg;
  },
  metadata: { taskPhase: "post", taskTypes: ["study"] },
});

registerTool("search_knowledge", {
  definition: {
    type: "function",
    function: {
      name: "search_knowledge",
      description: "按关键词搜索存储的知识点，返回匹配的主题及其内容",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          subject: { type: "string", description: "可选：限制在特定科目内" },
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
          `${i + 1}. [${kp.title}] ${(kp.content || "").substring(0, 300)}${(kp.content || "").length > 300 ? "..." : ""}${kp.alias ? ` (${kp.alias})` : ""}`,
      )
      .join("\n\n");
  },
  metadata: { taskPhase: "neutral", taskTypes: [] },
});

registerTool("import_questions", {
  definition: {
    type: "function",
    function: {
      name: "import_questions",
      description: "批量导入科目的问题，问题直接存储而不创建试卷",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "科目名称" },
          questions: {
            type: "array",
            description: "问题对象数组",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "问题文本" },
                answer: { type: "string", description: "正确答案" },
                explanation: { type: "string", description: "可选解释" },
                type: { type: "string", description: "short_answer, multiple_choice, 或 essay" },
                options: { type: "string", description: "对于选择题：JSON选项" },
                difficulty: { type: "number", description: "1-5" },
                knowledge_point: { type: "string", description: "知识点标题用于关联" },
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
      addQuestion(kpId, q.text, q.answer, q.type || "short_answer", q.explanation, q.difficulty, q.options);
      imported++;
    }

    return `Imported ${imported} question(s) for ${subjectName}. They are now available for quizzes.`;
  },
  metadata: { taskPhase: "neutral", taskTypes: [] },
});
