import { NewMessage, RegisteredGroup } from "./types.js";
/**
 * 初始化数据库
 *
 * 首次运行时创建数据库文件和表格
 */
export declare function initDatabase(): void;
/**
 * 存储消息到数据库
 *
 * @param msg 消息对象
 */
export declare function storeMessage(msg: NewMessage): void;
/**
 * 存储聊天元数据
 *
 * @param chatJid 聊天 ID
 * @param timestamp 最后消息时间
 * @param name 聊天名称（可选）
 * @param channel 频道类型（可选）
 * @param isGroup 是否为群组（可选）
 */
export declare function storeChatMetadata(chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean): void;
/**
 * 获取所有聊天列表
 *
 * @returns 聊天数组
 */
export declare function getAllChats(): {
    jid: string;
    name?: string;
}[];
/**
 * 获取指定时间之后的消息
 *
 * @param chatJid 聊天 ID
 * @param afterTimestamp 起始时间戳（空字符串表示从头开始）
 * @param assistantName AI 助手名称（用于过滤自己的消息）
 * @param limit 最大返回数量
 * @returns 消息数组
 */
export declare function getMessagesSince(chatJid: string, afterTimestamp: string, assistantName: string, limit: number): NewMessage[];
/**
 * 获取所有已注册的群组
 *
 * @returns 群组映射（jid -> RegisteredGroup）
 */
export declare function getAllRegisteredGroups(): Record<string, RegisteredGroup>;
/**
 * 设置群组注册信息
 *
 * @param jid 聊天 ID
 * @param group 群组配置
 */
export declare function setRegisteredGroup(jid: string, group: RegisteredGroup): void;
/**
 * 获取路由状态
 *
 * @param key 状态键
 * @returns 状态值（不存在返回 undefined）
 */
export declare function getRouterState(key: string): string | undefined;
/**
 * 设置路由状态
 *
 * @param key 状态键
 * @param value 状态值
 */
export declare function setRouterState(key: string, value: string): void;
//# sourceMappingURL=db.d.ts.map