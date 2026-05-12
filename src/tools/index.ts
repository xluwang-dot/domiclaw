import { RegisteredTool, ToolDefinition } from "../types.js";

const toolRegistry = new Map<string, RegisteredTool>();

/**
 * 注册工具函数
 * @param name 工具名称
 * @param tool 工具对象
 */
export function registerTool(name: string, tool: RegisteredTool): void {
  toolRegistry.set(name, tool);
}

/**
 * 根据名称获取工具
 * @param name 工具名称
 * @returns 工具对象或undefined
 */
export function getTool(name: string): RegisteredTool | undefined {
  return toolRegistry.get(name);
}

/**
 * 获取所有工具定义
 * @returns 工具定义数组
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return [...toolRegistry.values()].map((t) => t.definition);
}
