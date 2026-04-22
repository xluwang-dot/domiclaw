// 频道注册表 - 内联简化
import { Channel } from "../types.js";

export interface ChannelOpts {
  onMessage: (chatJid: string, msg: import("../types.js").NewMessage) => void;
  onChatMetadata: (
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ) => void;
  registeredGroups: () => Record<string, import("../types.js").RegisteredGroup>;
}

export type ChannelFactory = (opts: ChannelOpts) => Channel | null;
const channelRegistry = new Map<string, ChannelFactory>();

export function registerChannel(name: string, factory: ChannelFactory): void {
  channelRegistry.set(name, factory);
}

export function getChannelFactory(name: string): ChannelFactory | undefined {
  return channelRegistry.get(name);
}

export function getRegisteredChannelNames(): string[] {
  return [...channelRegistry.keys()];
}

// 导入并注册 TUI 频道
import { TUIChannel } from "./tui.js";
registerChannel("tui", TUIChannel);
