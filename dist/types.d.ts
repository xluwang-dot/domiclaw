/**
 * Domiclaw 类型定义模块
 *
 * 定义系统中使用的所有接口和类型
 */
/**
 * 已注册的群组
 *
 * 表示一个已配置的聊天群组/联系人
 */
export interface RegisteredGroup {
    /** 群组名称 */
    name: string;
    /** 群组文件夹（用于文件隔离）*/
    folder: string;
    /** 触发词（如 "@Domiclaw"）*/
    trigger: string;
    /** 添加时间（ISO 字符串）*/
    added_at: string;
    /** 容器配置（预留）*/
    containerConfig?: any;
    /** 是否需要触发词才能激活（默认 true）*/
    requiresTrigger?: boolean;
    /** 是否为主群（主群总是响应，无需触发词）*/
    isMain?: boolean;
}
/**
 * 新消息
 *
 * 表示收到的聊天消息
 */
export interface NewMessage {
    /** 消息 ID（频道特定）*/
    id: string;
    /** 聊天 ID（频道:jid 格式）*/
    chat_jid: string;
    /** 发送者 ID */
    sender: string;
    /** 发送者显示名称 */
    sender_name: string;
    /** 消息内容 */
    content: string;
    /** 时间戳（ISO 字符串）*/
    timestamp: string;
    /** 是否为机器人发送的消息 */
    is_from_me?: boolean;
    /** 是否为机器人回复的消息 */
    is_bot_message?: boolean;
    /** 话题/线程 ID（可选）*/
    thread_id?: string;
    /** 回复的消息 ID（可选）*/
    reply_to_message_id?: string;
    /** 回复的消息内容（可选）*/
    reply_to_message_content?: string;
    /** 回复的发送者名称（可选）*/
    reply_to_sender_name?: string;
}
/**
 * Channel 频道接口
 *
 * 消息频道需要实现的接口
 * 用于连接不同的消息平台（TUI/QQ/Telegram等）
 */
export interface Channel {
    /** 频道名称 */
    name: string;
    /** 连接频道（如登录 bot）*/
    connect(): Promise<void>;
    /** 发送消息到指定聊天 */
    sendMessage(jid: string, text: string): Promise<void>;
    /** 检查是否已连接 */
    isConnected(): boolean;
    /** 判断是否拥有此 JID（聊天 ID）*/
    ownsJid(jid: string): boolean;
    /** 断开连接 */
    disconnect(): Promise<void>;
    /** 可选：设置输入中状态（如 "正在输入..."）*/
    setTyping?: (jid: string, isTyping: boolean) => Promise<void>;
    /** 可选：同步群组/聊天列表 */
    syncGroups?: (force: boolean) => Promise<void>;
}
/**
 * 收到消息的回调函数类型
 *
 * 频道收到消息时调用此回调
 */
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;
/**
 * 收到聊天元数据的回调函数类型
 *
 * 频道发现新聊天或更新聊天信息时调用
 */
export type OnChatMetadata = (chatJid: string, // 聊天 ID
timestamp: string, // 时间戳
name?: string, // 聊天名称（可选）
channel?: string, // 频道名称（可选）
isGroup?: boolean) => void;
//# sourceMappingURL=types.d.ts.map