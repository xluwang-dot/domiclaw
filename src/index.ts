/**
 * Domiclaw — 主程序入口
 *
 * Web-first AI 学习助手。初始化数据库，连接频道，处理定时任务。
 */
import {
  ASSISTANT_NAME,
  POLL_INTERVAL,
} from "./config.js";

import {
  getChannelFactory,
  getRegisteredChannelNames,
} from "./channels/index.js";

import { pushSse } from "./channels/http.js";

import { runAgent, AgentOutput } from "./agent.js";

import {
  getAllRegisteredGroups,
  getAllDueScheduledTasks,
  updateScheduledTaskRun,
  cancelScheduledTask,
  initDatabase,
  storeMessage,
  setRouterState,
  getRouterState,
} from "./db.js";

import { formatMessages } from "./router.js";
import { Channel, NewMessage, RegisteredGroup } from "./types.js";
import { logger } from "./logger.js";

let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
const channels: Channel[] = [];

function loadState(): void {
  const agentTs = getRouterState("last_agent_timestamp");
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn("数据库中的时间戳数据损坏，重置为空");
    lastAgentTimestamp = {};
  }
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    "状态已加载",
  );
}

function saveState(): void {
  setRouterState("last_agent_timestamp", JSON.stringify(lastAgentTimestamp));
}

/**
 * 处理到期的定时任务（跨所有用户）
 * 运行 agent 并通过 SSE 推送结果到对应用户
 */
async function processScheduledTasks(): Promise<void> {
  try {
    const dueTasks = getAllDueScheduledTasks();
    for (const task of dueTasks) {
      const userId = parseInt(task.user_id, 10);
      if (!userId) continue;

      const group = registeredGroups[task.chat_jid];
      if (!group) continue;

      logger.info(
        { taskId: task.id, userId, type: task.schedule_type },
        "运行定时任务",
      );

      const taskPrompt = formatMessages([{
        id: `scheduled-${task.id}`,
        chat_jid: task.chat_jid,
        sender: "system",
        sender_name: "Scheduler",
        content: task.prompt,
        timestamp: new Date().toISOString(),
      } as NewMessage]);

      const output = await runAgent(
        group,
        {
          prompt: taskPrompt,
          chatJid: task.chat_jid,
          isMain: group.isMain === true,
          isScheduledTask: true,
          assistantName: ASSISTANT_NAME,
          userId,
        },
        async (result: AgentOutput) => {
          if (result.isPartial) {
            if (result.thinking) pushSse(userId, "thinking", { text: result.thinking });
            if (result.result) pushSse(userId, "token", { text: result.result });
          } else if (result.status === "success" && result.result) {
            storeMessage({
              id: `sched-bot-${Date.now()}`,
              chat_jid: task.chat_jid,
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
  logger.info("数据库已初始化");

  loadState();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "收到关闭信号");
    for (const ch of channels) ch.disconnect();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  const channelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      // Web channel handles its own message storage; this callback remains
      // for the generic Channel interface but is unused for web.
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => {
      // Web channel handles its own metadata storage.
    },
    registeredGroups: () => registeredGroups,
    onAgentProcessed: (chatJid: string, timestamp: string) => {
      lastAgentTimestamp[chatJid] = timestamp;
      saveState();
    },
  };

  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(channelOpts);
    if (!channel) {
      logger.warn({ channel: channelName }, "频道已安装但缺少配置 - 跳过");
      continue;
    }
    channels.push(channel);
    await channel.connect();
  }

  if (channels.length === 0) {
    logger.fatal("没有已连接的频道");
    process.exit(1);
  }

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
