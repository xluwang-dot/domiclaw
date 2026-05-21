import { logger } from "../logger.js";
import { TaskState, TaskStackItem, TaskPhase, TaskType } from "../types.js";
import { getTaskState, setTaskState } from "../db.js";
import { getTool } from "../tools/index.js";

export class TaskEngine {
  /**
   * 根据工具名推断是否应该进入任务模式
   * 当用户无活跃任务时，特定工具调用自动启动任务
   */
  static inferTask(toolName: string, userId: number, _params: Record<string, unknown>): TaskStackItem | null {
    const state = getTaskState(userId);
    if (state.active) return null; // 已有任务，不重复创建

    const taskMap: Record<string, { type: TaskType; title: string }> = {
      create_quiz: { type: "quiz", title: "测验" },
      get_due_reviews: { type: "review", title: "复习" },
      review_answer: { type: "review", title: "复习" },
      start_self_eval: { type: "self_eval", title: "1号计划摸底" },
    };

    const mapped = taskMap[toolName];
    if (!mapped) return null;

    const now = new Date().toISOString();
    const task: TaskStackItem = {
      taskId: `${mapped.type}_${Date.now()}_${userId}`,
      type: mapped.type,
      phase: "pre",
      title: mapped.title,
      startedAt: now,
    };
    return task;
  }

  /**
   * 检查当前任务模式下工具是否被允许调用
   */
  static taskGuard(toolName: string, currentTask: TaskStackItem): boolean {
    const tool = getTool(toolName);
    const meta = tool?.metadata;
    if (!meta) return true; // 无 metadata 的工具默认放行

    if (meta.taskPhase === "neutral") return true;
    if (!meta.taskTypes.includes(currentTask.type)) return false;
    return true;
  }

  /**
   * 更新任务阶段
   */
  static updatePhase(userId: number, phase: TaskPhase): void {
    const state = getTaskState(userId);
    if (!state.active || state.stack.length === 0) return;
    state.stack[state.stack.length - 1].phase = phase;
    setTaskState(userId, state);
  }

  /**
   * 结束当前任务（pop 栈顶）
   */
  static endTask(userId: number): TaskState {
    const state = getTaskState(userId);
    if (state.stack.length > 0) {
      const ended = state.stack.pop()!;
      logger.info({ taskId: ended.taskId, type: ended.type, title: ended.title }, "[Task] 任务结束");
    }
    state.active = state.stack.length > 0;
    setTaskState(userId, state);
    return state;
  }

  /**
   * 获取当前任务
   */
  static getCurrentTask(userId: number): TaskStackItem | null {
    const state = getTaskState(userId);
    if (!state.active || state.stack.length === 0) return null;
    return state.stack[state.stack.length - 1];
  }

  /**
   * 启动一个新任务并推到栈顶
   */
  static startTask(userId: number, task: TaskStackItem): void {
    const state = getTaskState(userId);
    state.stack.push(task);
    state.active = true;
    setTaskState(userId, state);
    logger.info({ taskId: task.taskId, type: task.type, title: task.title }, "[Task] 新任务启动");
  }

  /**
   * 构建 system prompt 中的 [当前任务] 块
   */
  static buildTaskPrompt(task: TaskStackItem): string {
    const lines: string[] = [];
    lines.push("[当前任务]");
    lines.push(`类型：${task.type}`);
    lines.push(`任务：${task.title}`);
    if (task.context?.progress) {
      const p = task.context.progress as { current?: number; total?: number };
      if (p.current !== undefined && p.total !== undefined) {
        lines.push(`进度：第 ${p.current}/${p.total} 步`);
      }
    }
    if (task.type === "self_eval") {
      lines.push("你正在进行1号计划摸底，引导学生逐章节自我评估。");
      lines.push("对每个章节，让学生选择：掌握了 / 不确定 / 不知道。");
      lines.push("如果学生不确定某个知识点，可以调用 create_quiz 生成几道题试试。");
      lines.push("使用 submit_self_assessment 工具记录评估结果。");
      lines.push("全部章节评估完成后，系统会自动生成复习计划。");
    }
    lines.push("你当前处于任务模式，请专注于当前任务。");
    lines.push("如果用户提出不相关的问题，温和引导回当前任务。");
    lines.push('用户可以通过点击"结束"按钮退出任务模式。');
    return lines.join("\n");
  }
}
