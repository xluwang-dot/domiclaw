---
type: "query"
date: "2026-04-29T09:27:20.679780+00:00"
question: "registerTool()"
contributor: "graphify"
source_nodes: ["registerTool()", "getTool()", "getAllToolDefinitions()", "registerChannel()"]
---

# Q: registerTool()

## Answer

registerTool() in src/tools/index.ts:5 adds tools to a Map-based registry. Connected to getTool() (L9) and getAllToolDefinitions() (L13) in the same file. Structurally parallels registerChannel() in src/channels/index.ts:21 which uses the same registration pattern. Fifteen individual tools call registerTool() across 5 modules (knowledge, quiz, review, study, reminder) but these call edges are not captured in the current AST extraction.

## Source Nodes

- registerTool()
- getTool()
- getAllToolDefinitions()
- registerChannel()