import { registerTool } from "./index.js";
import { renderProgressBar } from "./utils.js";
import {
  createStudyPlan,
  getActiveStudyPlan,
  getStudyPlan,
  getStudyPlanProgress,
  getStudyPlansByUser,
  markPlanTaskDone,
  getSubjectByName,
  getChaptersBySubject,
  getPlanProgress,
  initPlanProgress,
  upsertPlanProgress,
  getPlanProgressStats,
  getNextPendingKp,
  getAssessedKpCount,
  isPlanCompleted,
  completePlanProgress,
  updateNotebook,
  getPlanProgressWeakKps,
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

registerTool("start_self_eval", {
  definition: {
    type: "function",
    function: {
      name: "start_self_eval",
      description: "开始或恢复1号计划摸底。遍历该学科的章节知识点，引导学生进行自我评估。已有进度的从中断处继续。",
      parameters: {
        type: "object",
        properties: {
          subject_id: { type: "number", description: "学科 ID" },
        },
        required: ["subject_id"],
      },
    },
  },
  async execute(args, ctx) {
    const subjectId = args.subject_id as number;
    const userId = ctx.userId;

    // 检查是否已完成
    if (isPlanCompleted(userId, subjectId)) {
      const stats = getPlanProgressStats(userId, subjectId);
      return `该学科摸底已完成（已评估 ${stats.assessed}/${stats.total} 个知识点，${stats.mastered} 掌握，${stats.unsure} 不确定，${stats.unknown} 不知道）。如果想重新摸底，请先确认。`;
    }

    // 获取章节级知识点
    const chapters = getChaptersBySubject(subjectId);
    if (chapters.length === 0) {
      return "该学科下没有找到章节知识点，无法开始摸底。";
    }

    // 检查是否有进度
    const existing = getPlanProgress(userId, subjectId);
    if (existing.length === 0) {
      // 初始化摸底进度（用章节 ID）
      initPlanProgress(userId, subjectId, chapters.map(c => c.id));
    }

    const nextKp = getNextPendingKp(userId, subjectId);
    if (!nextKp) {
      // 所有已评估
      completePlanProgress(userId, subjectId);
      const stats = getPlanProgressStats(userId, subjectId);
      return `摸底已完成！共评估 ${stats.assessed} 个知识点：${stats.mastered} 掌握，${stats.unsure} 不确定，${stats.unknown} 不知道。系统已自动生成复习计划。`;
    }

    const stats = getPlanProgressStats(userId, subjectId);
    const assessed = getAssessedKpCount(userId, subjectId);
    const allKps = chapters.length;
    const nextChapter = chapters.find(c => c.id === nextKp.kp_id);
    const chapterName = nextChapter?.title || `知识点 #${nextKp.kp_id}`;

    return `📋 **1号计划摸底**
进度：已评估 ${assessed}/${allKps} 个章节（${stats.mastered} 掌握 / ${stats.unsure} 不确定 / ${stats.unknown} 不知道）

当前章节：**${chapterName}**

请自我评估你对「${chapterName}」的掌握程度：
- **掌握了** — 很熟悉，能解题
- **不确定** — 知道一些但不够自信
- **不知道** — 还没学过或基本不会

也可以说"做几道题试试"，我来出几题帮你判断。`;
  },
  metadata: { taskPhase: "pre", taskTypes: ["self_eval"] },
});

registerTool("submit_self_assessment", {
  definition: {
    type: "function",
    function: {
      name: "submit_self_assessment",
      description: "提交对当前知识点的自我评估。评估选项：mastered（掌握了）、unsure（不确定）、unknown（不知道）。",
      parameters: {
        type: "object",
        properties: {
          kp_id: { type: "number", description: "知识点 ID" },
          assessment: {
            type: "string",
            enum: ["mastered", "unsure", "unknown"],
            description: "自我评估结果",
          },
          subject_id: { type: "number", description: "学科 ID" },
        },
        required: ["kp_id", "assessment", "subject_id"],
      },
    },
  },
  async execute(args, ctx) {
    const kpId = args.kp_id as number;
    const assessment = args.assessment as string;
    const subjectId = args.subject_id as number;
    const userId = ctx.userId;

    // 更新评估
    upsertPlanProgress(userId, subjectId, kpId, assessment);

    // 如果掌握了，提升 notebook mastery
    if (assessment === "mastered") {
      updateNotebook(userId, subjectId, kpId, true);
    } else if (assessment === "unknown") {
      updateNotebook(userId, subjectId, kpId, false);
    }

    // 检查是否全部完成
    const nextKp = getNextPendingKp(userId, subjectId);
    if (!nextKp) {
      completePlanProgress(userId, subjectId);
      const stats = getPlanProgressStats(userId, subjectId);

      // 自动生成复习计划（薄弱知识点）
      const weakKps = getPlanProgressWeakKps(userId, subjectId);
      if (weakKps.length > 0) {
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + weakKps.length);
        const planTasks = weakKps.map((wkp, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() + i);
          return {
            day: i,
            date: d.toISOString().slice(0, 10),
            topic: wkp.kp_name,
            task: `复习「${wkp.kp_name}」— ${wkp.status === "unsure" ? "巩固练习" : "从头学习"}`,
            completed: false,
          };
        });
        const label = weakKps.every(k => k.status === "unsure") ? "巩固" : "基础";
        createStudyPlan(userId, `1号计划 — 薄弱点${label}复习`, planTasks,
          now.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10), subjectId);
      }

      let msg = `✅ **摸底完成！** 共评估 ${stats.total} 个章节。\n`;
      msg += `掌握：${stats.mastered} | 不确定：${stats.unsure} | 不知道：${stats.unknown}\n\n`;
      if (weakKps.length > 0) {
        msg += `📋 已为 ${weakKps.length} 个薄弱知识点自动生成复习计划。\n`;
        msg += `可以随时查看计划（/plan）或直接开始学习！`;
      } else {
        msg += `没有薄弱知识点，太棒了！可以开始正常学习了。`;
      }
      return msg;
    }

    const stats = getPlanProgressStats(userId, subjectId);
    const assessed = getAssessedKpCount(userId, subjectId);
    const chapters = getChaptersBySubject(subjectId);
    const nextChapter = chapters.find(c => c.id === nextKp.kp_id);
    const chapterName = nextChapter?.title || `知识点 #${nextKp.kp_id}`;

    const assessLabels: Record<string, string> = {
      mastered: "✅ 掌握了",
      unsure: "❓ 不确定",
      unknown: "📖 不知道",
    };

    return `${assessLabels[assessment] || assessment}，已记录。

进度：${assessed}/${chapters.length} 个章节已评估
掌握：${stats.mastered} | 不确定：${stats.unsure} | 不知道：${stats.unknown}

接下来评估：**${chapterName}**

请自我评估你对「${chapterName}」的掌握程度：
- **掌握了**
- **不确定**
- **不知道**

也可以说"做几道题试试"，我来出几题帮你判断。`;
  },
  metadata: { taskPhase: "during", taskTypes: ["self_eval"] },
});
