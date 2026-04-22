import { Channel } from "../types.js";
export interface ChannelOpts {
    onMessage: (chatJid: string, msg: import("../types.js").NewMessage) => void;
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) => void;
    registeredGroups: () => Record<string, import("../types.js").RegisteredGroup>;
}
export type ChannelFactory = (opts: ChannelOpts) => Channel | null;
export declare function registerChannel(name: string, factory: ChannelFactory): void;
export declare function getChannelFactory(name: string): ChannelFactory | undefined;
export declare function getRegisteredChannelNames(): string[];
//# sourceMappingURL=index.d.ts.map