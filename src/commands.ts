import {
  getAllSubjects,
  getStudyStats,
  getDueReviews,
  getActiveStudyPlan,
  getStudyPlanProgress,
  getSubjectByName,
  getQuestionsBySubject,
  createQuizSession,
  getWrongQuestionsBySubject,
  getSessionContext,
  upsertSessionContext,
} from "./db.js";

interface CommandCtx {
  chatJid: string;
  groupFolder: string;
}

function getCurrentSubject(chatJid: string): string | null {
  const ctx = getSessionContext(chatJid);
  return ctx?.topic || null;
}

function resolveSubject(subjectName?: string, currentSubject?: string | null): {
  name: string; id: number;
} | { error: string } {
  const name = subjectName || currentSubject;
  if (!name) return { error: "No subject specified. Use /subject <name> first, or pass a subject: /status math" };
  const s = getSubjectByName(name);
  if (!s) return { error: `Subject "${name}" not found.` };
  return { name: s.name, id: s.id };
}

export function handleCommand(text: string, ctx: CommandCtx): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  const currentSubject = getCurrentSubject(ctx.chatJid);

  switch (cmd) {
    case "help":
      return [
        "Available commands:",
        "/help — Show this list",
        `/subject [name] — Set or show current subject${currentSubject ? ` (now: ${currentSubject})` : ""}`,
        "/status [subject] — Show study statistics",
        "/review [subject] — Show due spaced repetition reviews",
        "/plan — Show study plan progress",
        `/quiz [subject] [count] — Create a quiz${currentSubject ? ` (default: ${currentSubject})` : ""}`,
        "/wrong [subject] — List wrong questions",
      ].join("\n");

    case "subject": {
      const name = args[0]?.toLowerCase();
      if (!name) {
        // Show or clear current subject
        if (currentSubject) {
          return `Current subject: ${currentSubject}. Use "/subject <name>" to change, or "/subject off" to clear.`;
        }
        return "No subject set. Use \"/subject <name>\" (e.g. \"/subject mathematics\").";
      }
      if (name === "off" || name === "clear" || name === "none") {
        upsertSessionContext(ctx.chatJid, "", null, null);
        return "Subject cleared. All subjects are now active.";
      }
      const s = getSubjectByName(name);
      if (!s) {
        const subjects = getAllSubjects().map((s) => s.name).join(", ");
        return `Subject "${name}" not found. Available: ${subjects}`;
      }
      upsertSessionContext(ctx.chatJid, s.name, null, null);
      return `Subject set to "${s.name}". Commands like /status, /review, /quiz now default to this subject.`;
    }

    case "status": {
      const resolved = resolveSubject(args[0], currentSubject);
      if ("error" in resolved) return resolved.error;
      const stats = getStudyStats(ctx.chatJid, resolved.id);
      const accuracy = stats.total_answers > 0
        ? Math.round((stats.correct_answers / stats.total_answers) * 100)
        : 0;
      return [
        `Study Stats: ${resolved.name}`,
        `Quizzes: ${stats.total_quizzes}`,
        `Answers: ${stats.total_answers} (${accuracy}% correct)`,
        `Wrong questions: ${stats.active_wrong_questions} active, ${stats.mastered_questions} mastered`,
        `Reviews due now: ${stats.due_reviews}`,
      ].join("\n");
    }

    case "review": {
      const resolved = resolveSubject(args[0], currentSubject);
      if ("error" in resolved) return resolved.error;
      const due = getDueReviews(ctx.chatJid, resolved.id);
      if (due.length === 0) return `No reviews due for ${resolved.name}. Great job!`;
      return [
        `${resolved.name} — ${due.length} review(s) due:`,
        ...due.map(
          (d, i) =>
            `${i + 1}. [Wrong ${d.wrong_count}x] ${d.question_text.substring(0, 120)}`,
        ),
      ].join("\n");
    }

    case "plan": {
      const plan = getActiveStudyPlan(ctx.chatJid);
      if (!plan) return "No active study plan. Ask Domiclaw to create one.";
      const progress = getStudyPlanProgress(plan.id);
      if (!progress) return "Error reading plan.";
      const bar = renderBar(progress.percent);
      const lines = [
        `${plan.title}: ${progress.completed}/${progress.total} ${bar}`,
      ];
      if (progress.upcoming.length > 0) {
        lines.push("Upcoming:");
        for (const t of progress.upcoming.slice(0, 3)) {
          lines.push(`  Day ${t.day} (${t.date}): ${t.task}`);
        }
      }
      return lines.join("\n");
    }

    case "quiz": {
      const resolved = resolveSubject(args[0], currentSubject);
      if ("error" in resolved) return resolved.error;
      const count = parseInt(args[1]) || 5;
      const questions = getQuestionsBySubject(resolved.id, 200);
      if (questions.length === 0) return `No questions for ${resolved.name}.`;
      const selected = questions
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(count, questions.length));
      const sessionId = createQuizSession(resolved.id, ctx.chatJid);
      return [
        `Quiz: ${resolved.name} (Session ${sessionId}), ${selected.length} questions\n`,
        ...selected.map(
          (q, i) => `Q${i + 1}. [ID: ${q.id}] ${q.question_text}`,
        ),
        "\nAnswer in the quiz panel or chat.",
      ].join("\n");
    }

    case "wrong": {
      const resolved = resolveSubject(args[0], currentSubject);
      if ("error" in resolved) return resolved.error;
      const wrong = getWrongQuestionsBySubject(ctx.chatJid, resolved.id);
      if (wrong.length === 0) return `No wrong questions for ${resolved.name}. Great!`;
      return [
        `${resolved.name} — ${wrong.length} wrong question(s):`,
        ...wrong.map(
          (w, i) =>
            `${i + 1}. ${w.question_text.substring(0, 100)} (wrong ${w.wrong_count}x${w.mastered ? ", mastered" : ""})`,
        ),
      ].join("\n");
    }

    default:
      return `Unknown command: /${cmd}. Type /help for available commands.`;
  }
}

function renderBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "[" + "█".repeat(filled) + "░".repeat(10 - filled) + `] ${pct}%`;
}
