import { registerTool } from "./index.js";
import {
  createScheduledTask,
  cancelScheduledTask,
  getScheduledTasksByUser,
} from "../db.js";

registerTool("schedule_daily_review", {
  definition: {
    type: "function",
    function: {
      name: "schedule_daily_review",
      description: "安排每日复习提醒。代理将在指定时间主动消息学生，检查待复习问题和学习计划进度",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string", description: "时间格式 HH:MM（例如：'09:00', '19:30'）" },
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
      ctx.userId,
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
      description: "按ID取消安排的提醒",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "提醒任务ID" },
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
      description: "列出当前学生的所有活动安排的提醒",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  async execute(args, ctx) {
    const tasks = getScheduledTasksByUser(ctx.userId);
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
