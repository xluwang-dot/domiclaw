/**
 * Domiclaw — 主程序入口
 *
 * Web-first AI 学习助手。初始化数据库，启动 Web 服务，处理定时任务。
 */
import {
  ASSISTANT_NAME,
  POLL_INTERVAL,
} from "./config.js";

import { startWebServer, pushSse } from "./channels/http.js";

import { runAgent, AgentOutput } from "./agent.js";

import {
  getAllDueScheduledTasks,
  updateScheduledTaskRun,
  cancelScheduledTask,
  initDatabase,
  storeMessage,
  purgeOldCache,
} from "./db.js";

import { formatMessages } from "./router.js";
import { NewMessage } from "./types.js";
import { initRetriever } from "./rag/index.js";
import { getDatabase } from "./db.js";
import { logger } from "./logger.js";

let lastAgentTimestamp: string | null = null;

function saveTimestamp(timestamp: string): void {
  lastAgentTimestamp = timestamp;
}

/**
 * 处理到期的定时任务（跨所有用户）
 * 运行 agent 并通过 SSE 推送结果到对应用户
 */
async function processScheduledTasks(): Promise<void> {
  try {
    const dueTasks = getAllDueScheduledTasks();
    for (const task of dueTasks) {
      const userId = task.user_id;
      if (!userId) continue;

      logger.info(
        { taskId: task.id, userId, type: task.schedule_type },
        "运行定时任务",
      );

      const taskPrompt = formatMessages([{
        id: `scheduled-${task.id}`,
        sender: "system",
        sender_name: "Scheduler",
        content: task.prompt,
        timestamp: new Date().toISOString(),
      } as NewMessage]);

      const output = await runAgent(
        {
          prompt: taskPrompt,
          fullContext: taskPrompt,
          isScheduledTask: true,
          assistantName: ASSISTANT_NAME,
          userId,
        },
        async (result: AgentOutput) => {
          if (result.isPartial) {
            if (result.toolEvent) {
              pushSse(userId, "tool_event", {
                type: result.toolEvent.type,
                name: result.toolEvent.name,
                args: result.toolEvent.args || null,
                resultPreview: result.toolEvent.resultPreview || null,
              });
            }
            if (result.thinking) pushSse(userId, "thinking", { text: result.thinking });
            if (result.result) pushSse(userId, "token", { text: result.result });
          } else if (result.status === "success" && result.result) {
            storeMessage({
              id: `sched-bot-${Date.now()}`,
              sender: ASSISTANT_NAME,
              sender_name: ASSISTANT_NAME,
              content: result.result,
              timestamp: new Date().toISOString(),
              is_bot_message: true,
            }, userId);
            pushSse(userId, "done", { status: "success", text: result.result });
          } else if (!result.isPartial) {
            pushSse(userId, "done", {
              status: "error",
              error: result.error || "Unknown error",
            });
          }
        },
      );

      const nextRun = computeNextRun(task.schedule_type, task.schedule_value);
      if (task.schedule_type === "once") {
        updateScheduledTaskRun(task.id, "", output.status);
        cancelScheduledTask(task.id);
      } else if (nextRun) {
        updateScheduledTaskRun(task.id, nextRun, output.status);
      }
    }
  } catch (err) {
    logger.error({ err }, "定时任务错误");
  }
}

function computeNextRun(type: string, value: string): string {
  const now = new Date();
  if (type === "daily") {
    const [h, m] = value.split(":").map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  if (type === "once") return "";
  if (type === "interval") {
    const minutes = parseInt(value, 10) || 60;
    return new Date(now.getTime() + minutes * 60000).toISOString();
  }
  return "";
}

/**
 * 定时任务轮询循环
 */
async function startSchedulerLoop(): Promise<void> {
  logger.info("定时任务调度器已启动");
  while (true) {
    await processScheduledTasks();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  initDatabase();
  initRetriever(getDatabase());
  logger.info("数据库已初始化");

  // 每 6 小时清理 30 天未命中的查询缓存
  setInterval(() => {
    const deleted = purgeOldCache(30);
    if (deleted > 0) logger.info({ deleted }, "AQC: 清理过期缓存");
  }, 6 * 3600 * 1000);

  // 启动 Web 服务器
  startWebServer(saveTimestamp);

  // 启动定时任务调度器
  startSchedulerLoop().catch((err) => {
    logger.fatal({ err }, "定时任务调度器意外崩溃");
    process.exit(1);
  });
}

const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, "启动 Domiclaw 失败");
    process.exit(1);
  });
}
