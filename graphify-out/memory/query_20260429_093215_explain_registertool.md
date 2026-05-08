---
type: "explain"
date: "2026-04-29T09:32:15.240154+00:00"
question: "Explain registerTool()"
contributor: "graphify"
source_nodes: ["registerTool()"]
---

# Q: Explain registerTool()

## Answer

registerTool() at src/tools/index.ts:5 stores a tool in a module-level Map<string, RegisteredTool>. It is a thin wrapper around Map.set() with no validation. Peer functions getTool() (L9) and getAllToolDefinitions() (L13) read from the same Map. Fifteen tools across 5 modules call registerTool() at module load time, making the registry implicitly populated on import. Structurally parallels registerChannel() in src/channels/index.ts which uses the same Map-based registration pattern.

## Source Nodes

- registerTool()