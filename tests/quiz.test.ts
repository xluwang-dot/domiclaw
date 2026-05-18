import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  addSubject,
  addKnowledgePoint,
  addQuestion,
  getSubjectByName,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";
import { getTool } from "../src/tools/index.js";
import "../src/tools/quiz.js"; // trigger tool registration

let testDb: Database.Database;

function seedQuestions(
  db: Database.Database,
  subjectId: number,
  difficulties: number[],
): void {
  const kpId = addKnowledgePoint(subjectId, "TestKP", "test");
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO sys_questions (knowledge_point_id, question_text, answer, difficulty, question_type, status, created_at)
     VALUES (?, ?, ?, ?, 'short_answer', 'published', ?)`
  );

  for (let i = 0; i < difficulties.length; i++) {
    insert.run(kpId, `Question ${i} (diff=${difficulties[i]})`, `Answer ${i}`, difficulties[i], now);
  }
}

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);
});

describe("create_quiz with difficulty filter", () => {
  it("should return only medium questions when filtered", async () => {
    const subjId = addSubject("TestDiffFilter", null);
    seedQuestions(testDb, subjId, [1, 1, 3, 3, 5, 5]);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { subject: "TestDiffFilter", question_count: 10, min_difficulty: 2.5, max_difficulty: 4.5 },
      { userId: 1, workspaceDir: "." },
    );

    // Should contain exactly 2 medium-difficulty questions
    expect(result).toContain("Questions: 2");
  });

  it("should return only hard questions when filtered", async () => {
    const subjId = addSubject("TestDiffFilter2", null);
    seedQuestions(testDb, subjId, [1, 2, 3, 4, 5, 5]);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { subject: "TestDiffFilter2", question_count: 10, min_difficulty: 4.5 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("Questions: 2");
  });

  it("should return all questions when no difficulty params provided", async () => {
    const subjId = addSubject("TestDiffFilter3", null);
    seedQuestions(testDb, subjId, [1, 2, 3, 4, 5]);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { subject: "TestDiffFilter3", question_count: 10 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("Questions: 5");
  });

  it("should handle no matching questions gracefully", async () => {
    const subjId = addSubject("TestDiffFilter4", null);
    seedQuestions(testDb, subjId, [5, 5, 5]);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { subject: "TestDiffFilter4", question_count: 10, min_difficulty: 1, max_difficulty: 2 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("No questions found");
  });
});
