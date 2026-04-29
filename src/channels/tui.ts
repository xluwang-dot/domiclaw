/**
 * Domiclaw TUI 频道模块
 *
 * TUI (Text User Interface) 控制台交互频道
 *
 * 功能:
 * - 从标准输入读取用户消息
 * - 向标准输出打印回复
 *
 * 消息格式:
 * - JID: tui:console
 * - 发送者：user
 * - 发送者名称：User
 */
import readline from "readline";
import { Channel, NewMessage } from "../types.js";
import type { ChannelOpts } from "./index.js";
import { logger } from "../logger.js";

/**
 * 创建 TUI 频道
 *
 * @param opts 频道选项（包含回调函数）
 * @returns Channel 接口
 */
export function TUIChannel(opts: ChannelOpts): Channel {
  // 回调函数
  let onMessageCb = opts.onMessage;
  let onChatMetadataCb = opts.onChatMetadata;

  // TUI 频道的聊天 ID
  const chatJid = "tui:console";

  // readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 消息计数器（用于生成唯一 ID）
  let messageCounter = 0;

  /**
   * 发送提示并等待输入
   *
   * 循环读取用户输入并处理
   */
  function sendPrompt(): void {
    // 使用 rl.question 获取输入
    rl.question("", (input) => {
      const trimmed = input.trim();

      // "exit" 退出程序
      if (trimmed.toLowerCase() === "exit") {
        logger.info("TUI 收到 exit 命令，正在退出");
        rl.close();
        process.exit(0);
        return;
      }

      // 跳过空输入
      if (!trimmed) {
        sendPrompt();
        return;
      }

      // 创建消息对象
      const msg: NewMessage = {
        id: `tui-${++messageCounter}`, // 唯一 ID
        chat_jid: chatJid, // 聊天 ID
        sender: "user", // 发送者
        sender_name: "User", // 发送者名称
        content: trimmed, // 消息内容
        timestamp: new Date().toISOString(), // 时间戳
        is_from_me: false, // 不是机器人发送
      };

      // 记录日志
      logger.info({ content: trimmed }, "TUI 收到输入");

      // 调用元数据回调
      onChatMetadataCb(chatJid, msg.timestamp, undefined, "tui", false);

      // 调用消息回调
      onMessageCb(chatJid, msg);

      // 继续等待下一条输入
      sendPrompt();
    });
  }

  /**
   * 连接频道
   *
   * 启动输入循环
   */
  async function connect(): Promise<void> {
    logger.info("TUI 频道已连接");
    console.log("\n=== Domiclaw TUI ===");
    console.log("输入消息发送给 AI Agent。");
    console.log('输入 "exit" 退出。\n');
    // 启动输入循环
    sendPrompt();
  }

  /**
   * 发送消息（打印到控制台）
   */
  async function sendMessage(jid: string, text: string): Promise<void> {
    process.stdout.write(`\n${text}\n`);
  }

  /**
   * 流式输出块 — thinking 用灰色，content 直接输出
   */
  async function sendChunk(
    jid: string,
    chunk: { thinking?: string; content?: string },
  ): Promise<void> {
    if (chunk.thinking) {
      process.stdout.write(`\x1b[2m${chunk.thinking}\x1b[0m`);
    }
    if (chunk.content) {
      process.stdout.write(chunk.content);
    }
  }

  /**
   * 判断是否拥有此 JID
   *
   * @param jid 聊天 ID
   * @returns 是否匹配
   */
  function ownsJid(jid: string): boolean {
    return jid.startsWith("tui:");
  }

  /**
   * 检查是否已连接
   *
   * @returns 连接状态
   */
  function isConnected(): boolean {
    return true;
  }

  /**
   * 断开连接
   *
   * 关闭 readline 接口
   */
  async function disconnect(): Promise<void> {
    rl.close();
  }

  // 返回 Channel 接口
  return {
    name: "tui",
    connect,
    sendMessage,
    isConnected,
    ownsJid,
    disconnect,
    sendChunk,
  };
}
