/**
 * Domiclaw 路由模块
 *
 * 负责消息格式化和路由:
 * - 格式化消息为 XML（用于发送给模型）
 * - 查找对应频道
 * - 转义特殊字符
 */
import { Channel, NewMessage } from "./types.js";

/**
 * 转义 XML 特殊字符
 *
 * 需要转义的字符: & < > "
 *
 * @param s 输入字符串
 * @returns 转义后的字符串
 */
export function escapeXml(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
 *   <message sender="用户名称" time="时间" reply_to="原消息ID">
 *     <quoted_message from="引用者">引用内容</quoted_message>
 *     回复的消息内容
 *   </message>
 * </messages>
 * ```
 *
 * @param messages 消息数组
 * @returns 格式化的 XML 字符串
 */
export function formatMessages(messages: NewMessage[]): string {
  // 将每条消息转换为 XML 元素
  const lines = messages.map((m) => {
    // 转换时间戳为可读格式
    const displayTime = new Date(m.timestamp).toLocaleString();

    // 处理回复引用
    const replyAttr = m.reply_to_message_id
      ? ` reply_to="${escapeXml(m.reply_to_message_id)}"`
      : "";

    // 处理引用消息内容
    const replySnippet =
      m.reply_to_message_content && m.reply_to_sender_name
        ? `\n  <quoted_message from="${escapeXml(m.reply_to_sender_name)}">${escapeXml(m.reply_to_message_content)}</quoted_message>`
        : "";

    // 构建消息元素
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${replyAttr}>${replySnippet}${escapeXml(m.content)}</message>`;
  });

  // 包装为 messages 标签
  return `<messages>\n${lines.join("\n")}\n</messages>`;
}

/**
 * 去除内部标签
 *
 * 用于从模型输出中提取纯文本
 * <internal>...</internal> 标签用于内部标记
 *
 * @param text 文本
 * @returns 去除标签后的文本
 */
export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, "").trim();
}

/**
 * 格式化输出文本
 *
 * @param rawText 原始文本
 * @returns 纯文本
 */
export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return "";
  return text;
}

/**
 * 查找对应聊天 ID 的频道
 *
 * @param channels 已连接的频道列表
 * @param jid 聊天 ID
 * @returns 匹配的频道（找不到返回 undefined）
 */
export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
