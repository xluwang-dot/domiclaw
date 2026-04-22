import { Channel, NewMessage } from "./types.js";
/**
 * 格式化消息数组为 XML 字符串
 *
 * 用于将消息历史转换为模型可读的格式
 *
 * XML 格式:
 * ```xml
 * <messages>
 *   <message sender="用户名称" time="时间">
 *     消息内容
 *   </message>
 *   <message sender="用户名称" time="时间" reply_to="原消息 ID">
 *     <quoted_message from="引用者">引用内容</quoted_message>
 *     回复的消息内容
 *   </message>
 * </messages>
 * ```
 *
 * @param messages 消息数组
 * @returns 格式化的 XML 字符串
 */
export declare function formatMessages(messages: NewMessage[]): string;
/**
 * 查找对应聊天 ID 的频道
 *
 * @param channels 已连接的频道列表
 * @param jid 聊天 ID
 * @returns 匹配的频道（找不到返回 undefined）
 */
export declare function findChannel(channels: Channel[], jid: string): Channel | undefined;
//# sourceMappingURL=router.d.ts.map