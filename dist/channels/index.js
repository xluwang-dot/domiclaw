const channelRegistry = new Map();
export function registerChannel(name, factory) {
    channelRegistry.set(name, factory);
}
export function getChannelFactory(name) {
    return channelRegistry.get(name);
}
export function getRegisteredChannelNames() {
    return [...channelRegistry.keys()];
}
// 导入并注册 TUI 频道
import { TUIChannel } from "./tui.js";
registerChannel("tui", TUIChannel);
//# sourceMappingURL=index.js.map