# Graph Report - src  (2026-05-09)

## Corpus Check
- Corpus is ~22,522 words - fits in a single context window. You may not need a graph.

## Summary
- 165 nodes · 300 edges · 10 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 71 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Quiz & Commands|Quiz & Commands]]
- [[_COMMUNITY_HTTP Server|HTTP Server]]
- [[_COMMUNITY_Config & Rate Limiter|Config & Rate Limiter]]
- [[_COMMUNITY_Authentication|Authentication]]
- [[_COMMUNITY_Agent Core|Agent Core]]
- [[_COMMUNITY_Knowledge Management|Knowledge Management]]
- [[_COMMUNITY_Study Planning|Study Planning]]
- [[_COMMUNITY_Logging & Env|Logging & Env]]
- [[_COMMUNITY_Scheduler & Reminders|Scheduler & Reminders]]
- [[_COMMUNITY_Database Init|Database Init]]

## God Nodes (most connected - your core abstractions)
1. `execute()` - 17 edges
2. `handleCommand()` - 14 edges
3. `execute()` - 12 edges
4. `execute()` - 9 edges
5. `runAgent()` - 8 edges
6. `processScheduledTasks()` - 8 edges
7. `getSubjectByName()` - 7 edges
8. `execute()` - 7 edges
9. `initDatabase()` - 5 edges
10. `getAllSubjects()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `initDatabase()` --calls--> `initAuthDb()`  [INFERRED]
  db.ts → auth.ts
- `main()` --calls--> `initDatabase()`  [INFERRED]
  index.ts → db.ts
- `handleCommand()` --calls--> `getAllSubjects()`  [INFERRED]
  commands.ts → db.ts
- `execute()` --calls--> `getAllSubjects()`  [INFERRED]
  tools/quiz.ts → db.ts
- `execute()` --calls--> `getSubjectByName()`  [INFERRED]
  tools/knowledge.ts → db.ts

## Communities

### Community 1 - "Quiz & Commands"
Cohesion: 0.11
Nodes (27): getCurrentSubject(), handleCommand(), renderBar(), resolveSubject(), clearKpWeaknessIfMastered(), createQuizSession(), getDueReviews(), getKpMasteryStats() (+19 more)

### Community 2 - "HTTP Server"
Cohesion: 0.16
Nodes (8): startWebServer(), getAllDueScheduledTasks(), updateScheduledTaskRun(), computeNextRun(), main(), processScheduledTasks(), startSchedulerLoop(), formatMessages()

### Community 3 - "Config & Rate Limiter"
Cohesion: 0.16
Nodes (8): buildTriggerPattern(), escapeRegex(), getTriggerPattern(), getKnowledgePointById(), setWrongQuestionRootKp(), updateQuizAnswerWeakKps(), RateLimiter, execute()

### Community 4 - "Authentication"
Cohesion: 0.16
Nodes (6): requireAuth(), createDefaultAdmin(), createUser(), getUserById(), hashPassword(), initAuthDb()

### Community 5 - "Agent Core"
Cohesion: 0.28
Nodes (9): buildSystemPrompt(), buildSystemPromptScheduled(), nonStreamingApiCall(), retry(), runAgent(), streamApiCall(), getWeakAreas(), getAllToolDefinitions() (+1 more)

### Community 6 - "Knowledge Management"
Cohesion: 0.22
Nodes (8): buildGraphData(), addExamPaper(), addKnowledgePoint(), addQuestion(), getAllKnowledgePoints(), getAllSubjects(), searchKnowledgePoints(), execute()

### Community 7 - "Study Planning"
Cohesion: 0.31
Nodes (8): createStudyPlan(), getActiveStudyPlan(), getStudyPlan(), getStudyPlanProgress(), getStudyPlansByUser(), markPlanTaskDone(), execute(), renderProgressBar()

### Community 8 - "Logging & Env"
Cohesion: 0.43
Nodes (4): formatData(), formatErr(), log(), ts()

### Community 9 - "Scheduler & Reminders"
Cohesion: 0.33
Nodes (5): cancelScheduledTask(), computeNextRun(), createScheduledTask(), getScheduledTasksByUser(), execute()

### Community 10 - "Database Init"
Cohesion: 0.67
Nodes (3): createSchema(), ensureRootKnowledgePoints(), initDatabase()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSubjectByName()` connect `Quiz & Commands` to `Database Queries`, `Knowledge Management`, `Study Planning`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `execute()` connect `Quiz & Commands` to `Config & Rate Limiter`, `Knowledge Management`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `execute()` (e.g. with `getSubjectByName()` and `getAllSubjects()`) actually correct?**
  _`execute()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handleCommand()` (e.g. with `upsertSessionContext()` and `getSubjectByName()`) actually correct?**
  _`handleCommand()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `execute()` (e.g. with `getSubjectByName()` and `getDueReviews()`) actually correct?**
  _`execute()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `execute()` (e.g. with `getSubjectByName()` and `createStudyPlan()`) actually correct?**
  _`execute()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `runAgent()` (e.g. with `getAllToolDefinitions()` and `getTool()`) actually correct?**
  _`runAgent()` has 3 INFERRED edges - model-reasoned connections that need verification._