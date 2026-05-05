import { registerTool } from "./index.js";
import {
  getQuestionById,
  updateQuizAnswerWeakKps,
  setWrongQuestionRootKp,
  getKnowledgePointById,
} from "../db.js";
import {
  MODEL_NAME,
  MODEL_BASE_URL,
  MODEL_API_KEY,
} from "../config.js";

registerTool("analyze_wrong_answer", {
  definition: {
    type: "function",
    function: {
      name: "analyze_wrong_answer",
      description:
        "Analyze a student's wrong answer to identify which related knowledge points are likely weak. " +
        "Use this when the answer is incorrect and you want to pinpoint the root cause knowledge gaps.",
      parameters: {
        type: "object",
        properties: {
          question_content: {
            type: "string",
            description: "The question text that the student answered",
          },
          student_answer: {
            type: "string",
            description: "The student's incorrect answer",
          },
          correct_answer: {
            type: "string",
            description: "The correct answer for reference",
          },
          related_kp_ids: {
            type: "array",
            items: { type: "number" },
            description: "Candidate knowledge point IDs associated with this question",
          },
          session_id: {
            type: "number",
            description: "The quiz session ID (optional, used to update the answer record)",
          },
          question_id: {
            type: "number",
            description: "The question ID (required to update tracking records)",
          },
          user_id: {
            type: "number",
            description: "The user ID (required to update tracking records)",
          },
        },
        required: ["question_content", "student_answer", "correct_answer", "related_kp_ids"],
      },
    },
  },
  async execute(args, ctx) {
    const questionContent = args.question_content as string;
    const studentAnswer = args.student_answer as string;
    const correctAnswer = args.correct_answer as string;
    const relatedKpIds = args.related_kp_ids as number[];
    const sessionId = args.session_id as number | undefined;
    const questionId = args.question_id as number | undefined;
    const userId = (args.user_id ?? ctx.userId) as number;

    if (!relatedKpIds || relatedKpIds.length === 0) {
      return `No related knowledge points provided — nothing to analyze.`;
    }

    // Resolve KP titles for context
    const kpLabels: string[] = [];
    for (const kpId of relatedKpIds) {
      const kp = getKnowledgePointById(kpId);
      kpLabels.push(kp ? `[ID ${kpId}] ${kp.title}` : `[ID ${kpId}] unknown`);
    }

    const systemPrompt =
      `You are an educational diagnostic assistant. Given a question, the student's wrong answer, ` +
      `and the correct answer, determine which of the provided knowledge points the student most ` +
      `likely has a gap in. Consider conceptual misunderstanding, factual errors, and procedural mistakes. ` +
      `Return ONLY valid JSON, no other text.\n\n` +
      `## Related Knowledge Points\n${kpLabels.join("\n")}`;

    const userPrompt =
      `## Question\n${questionContent}\n\n` +
      `## Correct Answer\n${correctAnswer}\n\n` +
      `## Student's Wrong Answer\n${studentAnswer}\n\n` +
      `Return JSON: {"weak_kp_ids": [number, ...], "reason": "Brief diagnostic explanation in Chinese"}. ` +
      `Only select from the provided knowledge point IDs. If no clear attribution, include all.`;

    try {
      const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MODEL_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        return `LLM analysis failed: HTTP ${response.status}${errText ? " — " + errText.substring(0, 200) : ""}`;
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return `LLM response could not be parsed as JSON. Raw: ${content.substring(0, 300)}`;
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        weak_kp_ids?: number[];
        reason?: string;
      };
      const weakKpIds = (parsed.weak_kp_ids || [])
        .filter((id: number) => relatedKpIds.includes(id));

      if (weakKpIds.length === 0) {
        return `Analysis: ${parsed.reason || "No weak KP identified"} (narrowed from ${relatedKpIds.length} candidates — all selected as weak)`;
      }

      // Persist to quiz_answers if session_id and question_id provided
      if (sessionId && questionId) {
        try {
          updateQuizAnswerWeakKps(sessionId, questionId, weakKpIds);
        } catch { /* non-critical */ }
      }

      // Set root_kp_id on wrong_questions for the primary weak KP
      if (questionId && userId) {
        try {
          setWrongQuestionRootKp(questionId, userId, weakKpIds[0]);
        } catch { /* non-critical */ }
      }

      const narrowedInfo = weakKpIds.length < relatedKpIds.length
        ? ` (narrowed from ${relatedKpIds.length} candidates)`
        : "";

      let kpDetail = "";
      if (weakKpIds.length <= 3) {
        const names: string[] = [];
        for (const id of weakKpIds) {
          const kp = getKnowledgePointById(id);
          if (kp) names.push(kp.title);
        }
        kpDetail = `\nWeak KPs: ${names.join(", ")}`;
      }

      return `Analysis complete${narrowedInfo}: ${parsed.reason}${kpDetail}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `LLM analysis error: ${msg}`;
    }
  },
});
