import { RegisteredTool, ToolDefinition } from "../types.js";

const toolRegistry = new Map<string, RegisteredTool>();

export function registerTool(name: string, tool: RegisteredTool): void {
  toolRegistry.set(name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return toolRegistry.get(name);
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return [...toolRegistry.values()].map((t) => t.definition);
}
