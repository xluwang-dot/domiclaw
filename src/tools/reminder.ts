import { registerTool } from "./index.js";
import {
  createScheduledTask,
  cancelScheduledTask,
  getScheduledTasksByJid,
} from "../db.js";

registerTool("schedule_daily_review", {
  definition: {
    type: "function",
    function: {
      name: "schedule_daily_review",
      description: "Schedule a daily review reminder. The agent will proactively message the student at the specified time to check due reviews and study plan progress.",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string", description: "Time in HH:MM format (e.g. '09:00', '19:30')" },
        },
        required: ["time"],
      },
    },
  },
  async execute(args, ctx) {
    const time = args.time as string;
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return `Invalid time format "${time}". Use HH:MM (e.g. '09:00').`;
    }

    const taskId = createScheduledTask(
      "main",
      ctx.chatJid,
      "It's time for your daily review. Check due spaced repetition questions (get_due_reviews) and study plan progress (get_study_progress). Offer encouragement.",
      "daily",
      time,
    );

    return `Daily review reminder scheduled at ${time} (ID: ${taskId}). I'll check in with you each day at that time.`;
  },
});

registerTool("cancel_reminder", {
  definition: {
    type: "function",
    function: {
      name: "cancel_reminder",
      description: "Cancel a scheduled reminder by its ID.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The reminder task ID" },
        },
        required: ["task_id"],
      },
    },
  },
  async execute(args) {
    const taskId = args.task_id as string;
    const ok = cancelScheduledTask(taskId);
    return ok
      ? `Reminder ${taskId} cancelled.`
      : `Reminder ${taskId} not found or already cancelled.`;
  },
});

registerTool("list_reminders", {
  definition: {
    type: "function",
    function: {
      name: "list_reminders",
      description: "List all active scheduled reminders for the current student.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  async execute(args, ctx) {
    const tasks = getScheduledTasksByJid(ctx.chatJid);
    if (tasks.length === 0) {
      return "No active reminders. Use schedule_daily_review to set one up.";
    }
    return tasks
      .map(
        (t) =>
          `${t.id}: ${t.schedule_type} at ${t.schedule_value} — next run: ${t.next_run || "N/A"}`,
      )
      .join("\n");
  },
});
