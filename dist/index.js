/**
 * Domiclaw - 主程序入口
 *
 * 一个极简的 AI Agent，通过消息频道接收用户输入，调用模型 API 生成回复。
 *
 * 工作流程:
 * 1. 启动时初始化数据库，加载已注册的群组
 * 2. 连接配置的频道（TUI/QQ/Telegram等）
 * 3. 循环轮询各频道的新消息
 * 4. 收到消息后调用模型 API 生成回复
 * 5. 将回复发送回对应频道
 *
 * 触发机制:
 * - 主群（isMain=true）无需触发词 always 响应
 * - 其他群需要触发词（如 @Domiclaw）才响应
 */
import { ASSISTANT_NAME, // AI 助手名称（如 "Domiclaw"）
DEFAULT_TRIGGER, // 默认触发词（如 "@Domiclaw"）
getTriggerPattern, // 获取触发词正则表达式
MAX_MESSAGES_PER_PROMPT, // 单次最多处理的消息数
POLL_INTERVAL, // 消息轮询间隔（毫秒）
 } from "./config.js";
// 导入频道模块（自动注册 TUI/QQ 等频道）
import { getChannelFactory, // 获取频道工厂函数
getRegisteredChannelNames, // 获取已注册的频道名列表
 } from "./channels/index.js";
// 导入 Agent 模块（调用模型 API）
import { runAgent } from "./agent.js";
// 导入数据库模块
import { getAllChats, // 获取所有聊天记录
getAllRegisteredGroups, // 获取所有已注册的群组
getMessagesSince, // 获取指定时间后的消息
getRouterState, // 获取路由状态（如最后处理时间戳）
initDatabase, // 设置群组注册信息
setRouterState, // 设置路由状态
storeChatMetadata, // 存储聊天元数据
storeMessage, // 存储消息
 } from "./db.js";
// 导入路由模块
import { findChannel, formatMessages } from "./router.js";
// 导入日志模块
import { logger } from "./logger.js";
// 全局状态
/**
 * 已注册的群组映射
 * key: jid（聊天ID，如 "tui:console"）
 * value: RegisteredGroup（群组配置）
 */
let registeredGroups = {};
/**
 * 每个群组最后处理消息的时间戳
 * 用于实现消息游标，支持增量处理新消息
 * key: jid
 * value: 最后处理的消息时间戳
 */
let lastAgentTimestamp = {};
/**
 * 已连接的频道列表
 * 支持多频道同时运行
 */
const channels = [];
/**
 * 从数据库加载运行时状态
 *
 * 包括:
 * - 已注册的群组列表
 * - 每个群组的最后处理时间戳（用于消息游标）
 */
function loadState() {
    // 获取最后处理时间戳
    const agentTs = getRouterState("last_agent_timestamp");
    try {
        // 解析 JSON 时间戳映射
        lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
    }
    catch {
        logger.warn("数据库中的时间戳数据损坏，重置为空");
        lastAgentTimestamp = {};
    }
    // 加载所有已注册的群组
    registeredGroups = getAllRegisteredGroups();
    logger.info({ groupCount: Object.keys(registeredGroups).length }, "状态已加载");
}
/**
 * 将运行时状态保存到数据库
 *
 * 保存内容:
 * - 每个群组的最后处理时间戳
 */
function saveState() {
    setRouterState("last_agent_timestamp", JSON.stringify(lastAgentTimestamp));
}
/**
 * 获取指定群组的最后处理游标
 *
 * @param chatJid 聊天 ID
 * @returns 最后处理的消��时间戳（空字符串表示从头开始）
 */
function getOrRecoverCursor(chatJid) {
    return lastAgentTimestamp[chatJid] || "";
}
/**
 * 处理单个群组的新消息
 *
 * @param chatJid 聊天 ID
 * @returns 是否处理成功
 *
 * 处理流程:
 * 1. 检查群组是否已注册
 * 2. 检查触发词（非主群需要）
 * 3. 调用模型 API 生成回复
 * 4. 发送回复到对应频道
 * 5. 更新游标
 */
async function processMessage(chatJid) {
    // 1. 获取群组配置
    const group = registeredGroups[chatJid];
    if (!group)
        return true; // 群组未注册，跳过
    // 2. 查找该群组对应的频道
    const channel = findChannel(channels, chatJid);
    if (!channel) {
        logger.warn({ chatJid }, "找不到对应的频道，跳过消息");
        return true;
    }
    // 判断是否为主群（主群总是响应）
    const isMainGroup = group.isMain === true;
    // 3. 获取未处理的新消息
    const missedMessages = getMessagesSince(chatJid, getOrRecoverCursor(chatJid), ASSISTANT_NAME, MAX_MESSAGES_PER_PROMPT);
    // 无新消息则退出
    if (missedMessages.length === 0)
        return true;
    // 4. 非主群需要触发词
    if (!isMainGroup && group.requiresTrigger !== false) {
        const triggerPattern = getTriggerPattern(group.trigger);
        const hasTrigger = missedMessages.some((m) => triggerPattern.test(m.content.trim()));
        if (!hasTrigger)
            return true; // 没有触发词，跳过
    }
    // 5. 格式化消息为 prompt
    const prompt = formatMessages(missedMessages);
    // 保存处理前的游标（用于错误回滚）
    const previousCursor = lastAgentTimestamp[chatJid] || "";
    // 更新游标为最后一条消息的时间戳
    lastAgentTimestamp[chatJid] =
        missedMessages[missedMessages.length - 1].timestamp;
    saveState();
    logger.info({ group: group.name, messageCount: missedMessages.length }, "正在处理消息");
    // 6. 显示输入中状态
    await channel.setTyping?.(chatJid, true);
    // 7. 调用模型 API 生成回复
    const output = await runAgent(group, {
        prompt, // 消息历史
        sessionId: "", // 会话ID（暂时不用）
        groupFolder: group.folder, // 群组文件夹
        chatJid, // 聊天ID
        isMain: isMainGroup, // 是否为主群
        assistantName: ASSISTANT_NAME, // AI 名称
    }, 
    // 回调：收到模型输出时发送消息
    async (result) => {
        if (result.result) {
            logger.info({ group: group.name }, `模型输出: ${result.result.length} 字符`);
            // 发送回复到频道
            await channel.sendMessage(chatJid, result.result);
        }
    });
    // 8. 隐藏输入中状态
    await channel.setTyping?.(chatJid, false);
    // 9. 处理错误则回滚游标
    if (output.status === "error") {
        lastAgentTimestamp[chatJid] = previousCursor;
        saveState();
        return false;
    }
    return true;
}
/**
 * 主消息循环
 *
 * 持续轮询所有聊天，检查新消息并处理
 *
 * 流程:
 * 1. 获取所有聊天
 * 2. 对于每个已注册的群组
 * 3. 检查是否有新消息
 * 4. 检查是否需要触发词
 * 5. 调用 processMessage 处理
 * 6. 等待 POLL_INTERVAL 后重复
 */
async function startMessageLoop() {
    logger.info(`Domiclaw 运行中（触发词: ${DEFAULT_TRIGGER}）`);
    // 无限循环
    while (true) {
        try {
            // 1. 获取所有聊天
            const chats = getAllChats();
            // 2. 遍历每个聊天
            for (const chat of chats) {
                // 检查群组是否已注册
                if (!registeredGroups[chat.jid])
                    continue;
                // 3. 获取未处理的新消息
                const pending = getMessagesSince(chat.jid, getOrRecoverCursor(chat.jid), ASSISTANT_NAME, MAX_MESSAGES_PER_PROMPT);
                // 有新消息则处理
                if (pending.length > 0) {
                    const group = registeredGroups[chat.jid];
                    const needsTrigger = !group.isMain && group.requiresTrigger !== false;
                    // 4. 检查触发词
                    if (needsTrigger) {
                        const triggerPattern = getTriggerPattern(group.trigger);
                        const hasTrigger = pending.some((m) => triggerPattern.test(m.content.trim()));
                        if (!hasTrigger)
                            continue;
                    }
                    // 5. 处理消息
                    await processMessage(chat.jid);
                }
            }
        }
        catch (err) {
            logger.error({ err }, "消息循环错误");
        }
        // 6. 等待后继续
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
}
/**
 * 主函数 - 初始化并启动
 *
 * 流程:
 * 1. 初始化数据库
 * 2. 加载状态
 * 3. 连接所有频道
 * 4. 启动消息循环
 */
async function main() {
    // 1. 初始化数据库（创建表等）
    initDatabase();
    logger.info("数据库已初始化");
    // 2. 加载状态
    loadState();
    // 设置关闭处理函数
    const shutdown = async (signal) => {
        logger.info({ signal }, "收到关闭信号");
        // 断开所有频道连接
        for (const ch of channels)
            await ch.disconnect();
        process.exit(0);
    };
    // 监听系统信号
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    // 频道选项（回调函数）
    const channelOpts = {
        // 收到新消息时的回调
        onMessage: (chatJid, msg) => {
            storeMessage(msg);
        },
        // 收到聊天元数据时的回调
        onChatMetadata: (chatJid, timestamp, name, channel, isGroup) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
        // 获取已注册群组的回调
        registeredGroups: () => registeredGroups,
    };
    // 3. 连接所有已注册的频道
    for (const channelName of getRegisteredChannelNames()) {
        const factory = getChannelFactory(channelName);
        const channel = factory(channelOpts);
        if (!channel) {
            logger.warn({ channel: channelName }, "频道已安装但缺少配置 - 跳过");
            continue;
        }
        channels.push(channel);
        await channel.connect();
    }
    // 没有可用频道则退出
    if (channels.length === 0) {
        logger.fatal("没有已连接的频道");
        process.exit(1);
    }
    // 4. 启动消息循环
    startMessageLoop().catch((err) => {
        logger.fatal({ err }, "消息循环意外崩溃");
        process.exit(1);
    });
}
/**
 * 判断是否直接运行此文件
 *
 * 用于支持两种运行方式:
 * 1. tsx src/index.ts（开发模式）
 * 2. node dist/index.js（生产模式）
 */
const isDirectRun = process.argv[1] &&
    new URL(import.meta.url).pathname ===
        new URL(`file://${process.argv[1]}`).pathname;
// 如果直接运行，则启动
if (isDirectRun) {
    main().catch((err) => {
        logger.error({ err }, "启动 Domiclaw 失败");
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map