import { registerTool } from "./index.js";
import {
  createStudyPlan,
  getActiveStudyPlan,
  getStudyPlan,
  getStudyPlanProgress,
  getStudyPlansByUser,
  markPlanTaskDone,
  getSubjectByName,
} from "../db.js";

registerTool("generate_study_plan", {
  definition: {
    type: "function",
    function: {
      name: "generate_study_plan",
      description:
        "存储生成的学习计划。plan_data是一个包含{day, date, topic, task, completed:false}对象的数组，覆盖从开始到结束的每一天。在AI创建计划结构后调用此函数。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "计划标题（例如：'数学期中备考'）" },
          subject: { type: "string", description: "科目名称（可选）" },
          start_date: { type: "string", description: "开始日期（YYYY-MM-DD）" },
          end_date: { type: "string", description: "结束日期（YYYY-MM-DD）" },
          plan_data: {
            type: "array",
            description: "每日任务数组。每个：{day: number, date: string, topic: string, task: string, completed: false}",
            items: {
              type: "object",
              properties: {
                day: { type: "number" },
                date: { type: "string" },
                topic: { type: "string" },
                task: { type: "string" },
                completed: { type: "boolean" },
              },
              required: ["day", "date", "topic", "task"],
            },
          },
        },
        required: ["title", "start_date", "end_date", "plan_data"],
      },
    },
  },
  async execute(args, ctx) {
    const title = args.title as string;
    const subjectName = args.subject as string | undefined;
    const startDate = args.start_date as string;
    const endDate = args.end_date as string;
    const planData = args.plan_data as Array<{
      day: number;
      date: string;
      topic: string;
      task: string;
      completed?: boolean;
    }>;

    let subjectId: number | undefined;
    if (subjectName) {
      const s = getSubjectByName(subjectName);
      if (s) subjectId = s.id;
    }

    const tasks = planData.map((t) => ({
      day: t.day,
      date: t.date,
      topic: t.topic,
      task: t.task,
      completed: t.completed || false,
    }));

    const planId = createStudyPlan(ctx.userId, title, tasks, startDate, endDate, subjectId);

    const days = tasks.length;
    return `Study plan "${title}" created (ID: ${planId}). ${days} days from ${startDate} to ${endDate}.\n\n` +
      tasks.map((t) => `Day ${t.day} (${t.date}): [${t.topic}] ${t.task}`).join("\n") +
      `\n\nUse mark_task_done with plan_id=${planId} and day_index to track progress.`;
  },
  metadata: { taskPhase: "neutral", taskTypes: [] },
});

registerTool("get_study_plan", {
  definition: {
    type: "function",
    function: {
      name: "get_study_plan",
      description: "获取带有进度的学习计划，显示已完成和剩余任务",
      parameters: {
        type: "object",
        properties: {
          plan_id: { type: "number", description: "计划ID（可选，默认为最近的活动计划）" },
        },
        required: [],
      },
    },
  },
  async execute(args, ctx) {
    const planId = args.plan_id as number | undefined;

    const plan = planId ? getStudyPlan(planId) : getActiveStudyPlan(ctx.userId);
    if (!plan) return "No study plan found. Ask me to generate one with your subjects and exam dates.";

    const progress = getStudyPlanProgress(plan.id);
    if (!progress) return "Error reading plan.";

    let response = `${plan.title} (ID: ${plan.id})\n`;
    response += `Period: ${plan.start_date} → ${plan.end_date}\n`;
    response += `Progress: ${progress.completed}/${progress.total} (${progress.percent}%)\n\n`;

    response += plan.tasks
      .map((t) => {
        const mark = t.completed ? "[x]" : `[${t.day}]`;
        return `${mark} ${t.date} | ${t.topic}: ${t.task}`;
      })
      .join("\n");

    if (progress.upcoming.length > 0) {
      response += "\n\nUpcoming:";
      for (const t of progress.upcoming) {
        response += `\n  Day ${t.day} (${t.date}): ${t.topic} — ${t.task}`;
      }
    }

    return response;
  },
  metadata: { taskPhase: "neutral", taskTypes: [] },
});

registerTool("mark_task_done", {
  definition: {
    type: "function",
    function: {
      name: "mark_task_done",
      description: "按天索引（从0开始）标记学习计划任务为已完成，返回更新后的进度",
      parameters: {
        type: "object",
        properties: {
          plan_id: { type: "number", description: "计划ID" },
          day_index: { type: "number", description: "天索引（从0开始，来自计划列表）" },
        },
        required: ["plan_id", "day_index"],
      },
    },
  },
  async execute(args) {
    const planId = args.plan_id as number;
    const dayIndex = args.day_index as number;

    const tasks = markPlanTaskDone(planId, dayIndex);
    if (!tasks) return `Plan ${planId} not found or invalid day index ${dayIndex}.`;

    const task = tasks[dayIndex];
    const completed = tasks.filter((t) => t.completed).length;
    const percent = Math.round((completed / tasks.length) * 100);

    return `Task marked done: Day ${task.day} — ${task.topic}: ${task.task}\nProgress: ${completed}/${tasks.length} (${percent}%)`;
  },
  metadata: { taskPhase: "during", taskTypes: ["quiz", "review", "study", "self_eval"] },
});

registerTool("get_study_progress", {
  definition: {
    type: "function",
    function: {
      name: "get_study_progress",
      description: "获取整体学习进度：活动计划、完成率、 upcoming任务",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  async execute(args, ctx) {
    const plans = getStudyPlansByUser(ctx.userId);
    if (plans.length === 0) {
      return "No study plans yet. Tell me your subjects and upcoming exam dates, and I'll create a study plan for you.";
    }

    let response = `You have ${plans.length} study plan(s):\n`;
    for (const p of plans) {
      const progress = getStudyPlanProgress(p.id);
      const bar = progress ? renderProgressBar(progress.percent) : "";
      response += `\n${p.title} (ID: ${p.id}): ${progress?.completed || 0}/${progress?.total || 0} ${bar}`;
      if (progress && progress.upcoming.length > 0) {
        const next = progress.upcoming[0];
        response += `\n  Next: Day ${next.day} (${next.date}) — ${next.task}`;
      }
    }
    return response;
  },
  metadata: { taskPhase: "post", taskTypes: ["quiz", "review", "study"] },
});

/**
 * 渲染进度条
 * @param percent 完成百分比
 * @returns 进度条字符串
 */
function renderProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  return "[" + "█".repeat(filled) + "░".repeat(10 - filled) + `] ${percent}%`;
}
