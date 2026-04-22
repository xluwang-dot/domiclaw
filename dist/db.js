/**
 * Domiclaw 数据库模块
 *
 * 使用 SQLite 存储所有数据:
 * - 聊天记录
 * - 消息历史
 * - 群组配置
 * - 路由状态
 *
 * 表格:
 * - chats: 聊天/群组元数据
 * - messages: 消息历史
 * - registered_groups: 已注册的群组
 * - router_state: 路由状态（如游标）
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { STORE_DIR } from "./config.js";
/**
 * SQLite 数据库实例
 */
let db;
/**
 * 创建数据库表格
 *
 * @param database 数据库实例
 */
function createSchema(database) {
    // 创建所有必要的表格
    database.exec(`
    -- 聊天/群组元数据表
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,           -- 聊天 ID（唯一标识）
      name TEXT,                 -- 聊天名称
      last_message_time TEXT,     -- 最后消息时间
      channel TEXT,             -- 频道类型（tui/qq/telegram）
      is_group INTEGER DEFAULT 0  -- 是否为群组
    );

    -- 消息历史表
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,                    -- 消息 ID
      chat_jid TEXT,            -- 聊天 ID（外键）
      sender TEXT,             -- 发送者 ID
      sender_name TEXT,         -- 发送者名称
      content TEXT,            -- 消息内容
      timestamp TEXT,          -- 时间戳
      is_from_me INTEGER,       -- 是否为机器人发送
      is_bot_message INTEGER DEFAULT 0,  -- 是否为机器人回复
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    -- 消息时间戳索引（加速查询）
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    -- 已注册的群组表
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,          -- 聊天 ID
      name TEXT NOT NULL,            -- 群组名称
      folder TEXT NOT NULL UNIQUE,    -- 群组文件夹（唯一）
      trigger_pattern TEXT NOT NULL,  -- 触发词
      added_at TEXT NOT NULL,         -- 添加时间
      container_config TEXT,         -- 容器配置（预留）
      requires_trigger INTEGER DEFAULT 1,  -- 是否需要触发词
      is_main INTEGER DEFAULT 0       -- 是否为主群
    );

    -- 路由状态表（存储游标等）
    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,    -- 状态键
      value TEXT NOT NULL  -- 状态值
    );
  `);
}
/**
 * 初始化数据库
 *
 * 首次运行时创建数据库文件和表格
 */
export function initDatabase() {
    // 构建数据库路径
    const dbPath = path.join(STORE_DIR, "messages.db");
    // 确保目录存在
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    // 打开/创建数据库
    db = new Database(dbPath);
    // 创建表格
    createSchema(db);
}
/**
 * 存储消息到数据库
 *
 * @param msg 消息对象
 */
export function storeMessage(msg) {
    // 使用 INSERT OR REPLACE 确保幂等
    db.prepare(`
    INSERT OR REPLACE INTO messages 
    (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.chat_jid, msg.sender, msg.sender_name, msg.content, msg.timestamp, msg.is_from_me ? 1 : 0, msg.is_bot_message ? 1 : 0);
    // 更新聊天的最后消息时间
    db.prepare(`
    INSERT OR REPLACE INTO chats (jid, last_message_time)
    VALUES (?, ?)
  `).run(msg.chat_jid, msg.timestamp);
}
/**
 * 存储聊天元数据
 *
 * @param chatJid 聊天 ID
 * @param timestamp 最后消息时间
 * @param name 聊天名称（可选）
 * @param channel 频道类型（可选）
 * @param isGroup 是否为群组（可选）
 */
export function storeChatMetadata(chatJid, timestamp, name, channel, isGroup) {
    // 解析频道和群组标志
    const ch = channel ?? null;
    const group = isGroup === undefined ? null : isGroup ? 1 : 0;
    if (name) {
        // 更新名称，保留较新的时间戳
        db.prepare(`
      UPDATE chats 
      SET name = ?, last_message_time = COALESCE(
        (SELECT last_message_time FROM chats WHERE jid = ?), ?
      )
      WHERE jid = ? OR jid IS NULL
    `).run(name, chatJid, timestamp, chatJid);
    }
}
/**
 * 获取所有聊天列表
 *
 * @returns 聊天数组
 */
export function getAllChats() {
    return db.prepare("SELECT jid, name FROM chats").all();
}
/**
 * 获取指定时间之后的消息
 *
 * @param chatJid 聊天 ID
 * @param afterTimestamp 起始时间戳（空字符串表示从头开始）
 * @param assistantName AI 助手名称（用于过滤自己的消息）
 * @param limit 最大返回数量
 * @returns 消息数组
 */
export function getMessagesSince(chatJid, afterTimestamp, assistantName, limit) {
    // 构建查询
    let query = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
  `;
    const params = [chatJid, afterTimestamp];
    // 过滤参数
    query += ` ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);
    return db.prepare(query).all(...params);
}
/**
 * 获取所有已注册的群组
 *
 * @returns 群组映射（jid -> RegisteredGroup）
 */
export function getAllRegisteredGroups() {
    const rows = db
        .prepare(`
    SELECT jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main
    FROM registered_groups
  `)
        .all();
    // 转换为映射
    const groups = {};
    for (const row of rows) {
        groups[row.jid] = {
            name: row.name,
            folder: row.folder,
            trigger: row.trigger_pattern,
            added_at: row.added_at,
            requiresTrigger: row.requires_trigger === 1,
            isMain: row.is_main === 1,
        };
    }
    return groups;
}
/**
 * 设置群组注册信息
 *
 * @param jid 聊天 ID
 * @param group 群组配置
 */
export function setRegisteredGroup(jid, group) {
    db.prepare(`
    INSERT OR REPLACE INTO registered_groups 
    (jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(jid, group.name, group.folder, group.trigger, group.added_at, group.requiresTrigger !== false ? 1 : 0, group.isMain ? 1 : 0);
}
/**
 * 获取路由状态
 *
 * @param key 状态键
 * @returns 状态值（不存在返回 undefined）
 */
export function getRouterState(key) {
    const row = db
        .prepare("SELECT value FROM router_state WHERE key = ?")
        .get(key);
    return row?.value;
}
/**
 * 设置路由状态
 *
 * @param key 状态键
 * @param value 状态值
 */
export function setRouterState(key, value) {
    db.prepare(`
    INSERT OR REPLACE INTO router_state (key, value)
    VALUES (?, ?)
  `).run(key, value);
}
//# sourceMappingURL=db.js.map