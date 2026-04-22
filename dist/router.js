/**
 * Domiclaw 路由模块
 *
 * 负责消息格式化和路由:
 * - 格式化消息为 XML（用于发送给模型）
 * - 查找对应频道
 */
import escapeHtml from "escape-html";
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
export function formatMessages(messages) {
    // 将每条消息转换为 XML 元素
    const lines = messages.map((m) => {
        // 转换时间戳为可读格式
        const displayTime = new Date(m.timestamp).toLocaleString();
        // 处理回复引用
        const replyAttr = m.reply_to_message_id
            ? ` reply_to="${escapeHtml(m.reply_to_message_id)}"`
            : "";
        // 处理引用消息内容
        const replySnippet = m.reply_to_message_content && m.reply_to_sender_name
            ? `\n  <quoted_message from="${escapeHtml(m.reply_to_sender_name)}">${escapeHtml(m.reply_to_message_content)}</quoted_message>`
            : "";
        // 构建消息元素
        return `<message sender="${escapeHtml(m.sender_name)}" time="${escapeHtml(displayTime)}"${replyAttr}>${replySnippet}${escapeHtml(m.content)}</message>`;
    });
    // 包装为 messages 标签
    return `<messages>\n${lines.join("\n")}\n</messages>`;
}
/**
 * 查找对应聊天 ID 的频道
 *
 * @param channels 已连接的频道列表
 * @param jid 聊天 ID
 * @returns 匹配的频道（找不到返回 undefined）
 */
export function findChannel(channels, jid) {
    return channels.find((c) => c.ownsJid(jid));
}
//# sourceMappingURL=router.js.map