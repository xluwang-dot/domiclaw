---
type: "query"
date: "2026-04-29T09:22:06.931662+00:00"
question: "list all available tools"
contributor: "graphify"
source_nodes: ["registerTool()", "add_knowledge_point", "create_quiz", "get_due_reviews", "generate_study_plan", "schedule_daily_review"]
---

# Q: list all available tools

## Answer

15 tools across 5 modules: knowledge (add_knowledge_point, search_knowledge, add_exam_paper, import_questions), quiz (create_quiz, record_answer, export_wrong_questions), review (get_due_reviews, review_answer, get_study_stats), study (generate_study_plan, get_study_plan, mark_task_done, get_study_progress), reminder (schedule_daily_review, cancel_reminder, list_reminders). Registered via registerTool() in src/tools/index.ts.

## Source Nodes

- registerTool()
- add_knowledge_point
- create_quiz
- get_due_reviews
- generate_study_plan
- schedule_daily_review