# Graph Report - .  (2026-05-05)

## Corpus Check
- Corpus is ~32,030 words - fits in a single context window. You may not need a graph.

## Summary
- 183 nodes · 317 edges · 20 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 75 edges (avg confidence: 0.8)
- Token cost: 33,748 input · 2,400 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Command & Quiz Flow|Command & Quiz Flow]]
- [[_COMMUNITY_Agent Core & Prompt|Agent Core & Prompt]]
- [[_COMMUNITY_Web Server & SSE|Web Server & SSE]]
- [[_COMMUNITY_Authentication Layer|Authentication Layer]]
- [[_COMMUNITY_Core Module Dependencies|Core Module Dependencies]]
- [[_COMMUNITY_Config & Rate Limiting|Config & Rate Limiting]]
- [[_COMMUNITY_Concepts & Documentation|Concepts & Documentation]]
- [[_COMMUNITY_Study Plan System|Study Plan System]]
- [[_COMMUNITY_Env & Logging|Env & Logging]]
- [[_COMMUNITY_Knowledge Tools|Knowledge Tools]]
- [[_COMMUNITY_Reminder & Scheduler|Reminder & Scheduler]]
- [[_COMMUNITY_Graph Data API|Graph Data API]]
- [[_COMMUNITY_Schema Initialization|Schema Initialization]]
- [[_COMMUNITY_Tool Registry & Study|Tool Registry & Study]]
- [[_COMMUNITY_Canvas Component|Canvas Component]]
- [[_COMMUNITY_Config Module|Config Module]]
- [[_COMMUNITY_Type Definitions|Type Definitions]]
- [[_COMMUNITY_Logger|Logger]]
- [[_COMMUNITY_Rate Limiter|Rate Limiter]]
- [[_COMMUNITY_Agent Persona|Agent Persona]]

## God Nodes (most connected - your core abstractions)
1. `execute()` - 16 edges
2. `handleCommand()` - 14 edges
3. `execute()` - 12 edges
4. `execute()` - 9 edges
5. `Database Layer` - 9 edges
6. `runAgent()` - 8 edges
7. `processScheduledTasks()` - 8 edges
8. `getSubjectByName()` - 7 edges
9. `execute()` - 7 edges
10. `AI Agent Core` - 7 edges

## Surprising Connections (you probably didn't know these)
- `initDatabase()` --calls--> `initAuthDb()`  [INFERRED]
  db.ts → auth.ts
- `main()` --calls--> `initDatabase()`  [INFERRED]
  index.ts → db.ts
- `handleCommand()` --calls--> `getAllSubjects()`  [INFERRED]
  commands.ts → db.ts
- `execute()` --calls--> `getAllSubjects()`  [INFERRED]
  tools/knowledge.ts → db.ts
- `execute()` --calls--> `getAllSubjects()`  [INFERRED]
  tools/quiz.ts → db.ts

## Hyperedges (group relationships)
- **Agent Tool Registration and Execution System** — agent_agent, tools_knowledge, tools_quiz, tools_review, tools_analyze, tools_reminder, tools_index_registerTool [EXTRACTED 1.00]
- **Learning Assessment Feedback Loop** — tools_quiz, tools_analyze, tools_review, db_database [INFERRED 0.85]
- **Development Workflow System** — doc_CLAUDE_md, doc_tasklist, doc_buglist, concept_dev_workflow [EXTRACTED 1.00]
- **Knowledge Graph Visualization Subsystem** — web_app_html, concept_ewma, channels_http_server, db_database [INFERRED 0.90]

## Communities

### Community 1 - "Command & Quiz Flow"
Cohesion: 0.11
Nodes (27): getCurrentSubject(), handleCommand(), renderBar(), resolveSubject(), clearKpWeaknessIfMastered(), createQuizSession(), getDueReviews(), getKpMasteryStats() (+19 more)

### Community 2 - "Agent Core & Prompt"
Cohesion: 0.18
Nodes (13): buildSystemPrompt(), buildSystemPromptScheduled(), nonStreamingApiCall(), retry(), runAgent(), streamApiCall(), getKnowledgePointById(), getWeakAreas() (+5 more)

### Community 3 - "Web Server & SSE"
Cohesion: 0.16
Nodes (8): startWebServer(), getAllDueScheduledTasks(), updateScheduledTaskRun(), computeNextRun(), main(), processScheduledTasks(), startSchedulerLoop(), formatMessages()

### Community 4 - "Authentication Layer"
Cohesion: 0.16
Nodes (6): requireAuth(), createDefaultAdmin(), createUser(), getUserById(), hashPassword(), initAuthDb()

### Community 5 - "Core Module Dependencies"
Cohesion: 0.35
Nodes (11): AI Agent Core, Authentication Module, Command Handler, Database Layer, Main Entry Point, Message Router, Wrong Answer Analysis Tool, Knowledge Management Tools (+3 more)

### Community 6 - "Config & Rate Limiting"
Cohesion: 0.27
Nodes (4): buildTriggerPattern(), escapeRegex(), getTriggerPattern(), RateLimiter

### Community 7 - "Concepts & Documentation"
Cohesion: 0.24
Nodes (10): HTTP + Web Server + API, Four-Step Dev Workflow, EWMA Mastery Algorithm, Multi-User Data Isolation, SM-2 Spaced Repetition, Project CLAUDE.md, Project README, Admin Panel (+2 more)

### Community 8 - "Study Plan System"
Cohesion: 0.31
Nodes (8): createStudyPlan(), getActiveStudyPlan(), getStudyPlan(), getStudyPlanProgress(), getStudyPlansByUser(), markPlanTaskDone(), execute(), renderProgressBar()

### Community 9 - "Env & Logging"
Cohesion: 0.43
Nodes (4): formatData(), formatErr(), log(), ts()

### Community 10 - "Knowledge Tools"
Cohesion: 0.33
Nodes (5): addExamPaper(), addKnowledgePoint(), addQuestion(), searchKnowledgePoints(), execute()

### Community 11 - "Reminder & Scheduler"
Cohesion: 0.33
Nodes (5): cancelScheduledTask(), computeNextRun(), createScheduledTask(), getScheduledTasksByUser(), execute()

### Community 12 - "Graph Data API"
Cohesion: 0.67
Nodes (3): buildGraphData(), getAllSubjects(), getKnowledgePointsBySubject()

### Community 13 - "Schema Initialization"
Cohesion: 1.0
Nodes (2): createSchema(), initDatabase()

### Community 15 - "Tool Registry & Study"
Cohesion: 1.0
Nodes (2): Tool Registry, Study Plan Tools

### Community 16 - "Canvas Component"
Cohesion: 1.0
Nodes (1): Infinite Canvas Component

### Community 17 - "Config Module"
Cohesion: 1.0
Nodes (1): Configuration Module

### Community 18 - "Type Definitions"
Cohesion: 1.0
Nodes (1): Type Definitions

### Community 19 - "Logger"
Cohesion: 1.0
Nodes (1): Logger

### Community 20 - "Rate Limiter"
Cohesion: 1.0
Nodes (1): Rate Limiter

### Community 21 - "Agent Persona"
Cohesion: 1.0
Nodes (1): Agent AGENT.md

## Knowledge Gaps
- **15 isolated node(s):** `Infinite Canvas Component`, `Configuration Module`, `Authentication Module`, `Type Definitions`, `Command Handler` (+10 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Schema Initialization`** (2 nodes): `createSchema()`, `initDatabase()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tool Registry & Study`** (2 nodes): `Tool Registry`, `Study Plan Tools`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Canvas Component`** (1 nodes): `Infinite Canvas Component`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Config Module`** (1 nodes): `Configuration Module`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Type Definitions`** (1 nodes): `Type Definitions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Logger`** (1 nodes): `Logger`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Rate Limiter`** (1 nodes): `Rate Limiter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Agent Persona`** (1 nodes): `Agent AGENT.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSubjectByName()` connect `Command & Quiz Flow` to `DB CRUD Functions`, `Study Plan System`, `Knowledge Tools`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `processScheduledTasks()` connect `Web Server & SSE` to `Agent Core & Prompt`, `Reminder & Scheduler`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `execute()` (e.g. with `getSubjectByName()` and `getAllSubjects()`) actually correct?**
  _`execute()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handleCommand()` (e.g. with `upsertSessionContext()` and `getSubjectByName()`) actually correct?**
  _`handleCommand()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `execute()` (e.g. with `getSubjectByName()` and `getDueReviews()`) actually correct?**
  _`execute()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `execute()` (e.g. with `getSubjectByName()` and `createStudyPlan()`) actually correct?**
  _`execute()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Infinite Canvas Component`, `Configuration Module`, `Authentication Module` to the rest of the system?**
  _15 weakly-connected nodes found - possible documentation gaps or missing edges._