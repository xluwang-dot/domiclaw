---
type: "explain"
date: "2026-04-30T09:18:03.430479+00:00"
question: "Explain 无限画布 infinite canvas"
contributor: "graphify"
source_nodes: ["Knowledge Graph Canvas", "Infinite Canvas Component"]
---

# Q: Explain 无限画布 infinite canvas

## Answer

无限画布功能在 web/app.html（原 index.html）中实现，使用 Vue 3 + CSS transform。两层结构：canvas-layer（固定 inset:0）和 canvas-transform（5000x5000px，transform: translate + scale）。鼠标滚轮缩放（wheel 事件），鼠标拖拽平移（mousedown/mousemove）。节点使用 graph-node class 绝对定位。

## Source Nodes

- Knowledge Graph Canvas
- Infinite Canvas Component