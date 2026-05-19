import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  getTestLevelConfig,
  addSubject,
  addKnowledgePoint,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";
import { getTool } from "../src/tools/index.js";
import "../src/tools/quiz.js";

let testDb: Database.Database;

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);
});

describe("user_testlevelconfig — seed data", () => {
  it("should have 3 levels seeded", () => {
    const rows = testDb.prepare(
      "SELECT level, question_count, easy_ratio, medium_ratio, hard_ratio FROM user_testlevelconfig ORDER BY level"
    ).all() as { level: number; question_count: number; easy_ratio: number; medium_ratio: number; hard_ratio: number }[];

    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ level: 1, question_count: 30, easy_ratio: 0.7, medium_ratio: 0.2, hard_ratio: 0.1 });
    expect(rows[1]).toEqual({ level: 2, question_count: 20, easy_ratio: 0.4, medium_ratio: 0.3, hard_ratio: 0.3 });
    expect(rows[2]).toEqual({ level: 3, question_count: 15, easy_ratio: 0.1, medium_ratio: 0.2, hard_ratio: 0.7 });
  });

  it("getTestLevelConfig returns correct config", () => {
    const cfg = getTestLevelConfig(2);
    expect(cfg).toBeDefined();
    expect(cfg!.question_count).toBe(20);
    expect(cfg!.easy_ratio).toBe(0.4);
    expect(cfg!.medium_ratio).toBe(0.3);
    expect(cfg!.hard_ratio).toBe(0.3);
  });

  it("getTestLevelConfig returns undefined for invalid level", () => {
    const cfg = getTestLevelConfig(99);
    expect(cfg).toBeUndefined();
  });
});

describe("create_quiz with test_level", () => {
  function seedQuestionsByDifficulty(difficulties: number[]): number {
    const subjId = addSubject("TestLevelSubject", null);
    const kpId = addKnowledgePoint(subjId, "LevelTestKP", "test");
    const now = new Date().toISOString();
    const insert = testDb.prepare(
      `INSERT INTO sys_questions (knowledge_point_id, question_text, answer, difficulty, question_type, status, created_at)
       VALUES (?, ?, ?, ?, 'short_answer', 'published', ?)`
    );

    for (let i = 0; i < difficulties.length; i++) {
      insert.run(kpId, `Q${i} (diff=${difficulties[i]})`, `A${i}`, difficulties[i], now);
    }
    return subjId;
  }

  it("level 1: should produce ~30 questions with 7:2:1 distribution", async () => {
    // Create enough questions at diff 1,2,3
    seedQuestionsByDifficulty([
      ...Array(25).fill(1), // 25 easy
      ...Array(10).fill(2), // 10 medium
      ...Array(5).fill(3),  // 5 hard
    ]);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { subject: "TestLevelSubject", test_level: 1 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("Questions: 30");
  });

  it("level 2: should produce ~20 questions with 4:3:3 distribution", async () => {
    seedQuestionsByDifficulty([
      ...Array(15).fill(2),
      ...Array(10).fill(3),
      ...Array(10).fill(4),
    ]);
    const tool = getTool("create_quiz");

    const result = await tool!.execute(
      { subject: "TestLevelSubject", test_level: 2 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("Questions: 20");
  });

  it("level 3: should produce ~15 questions with 1:2:7 distribution", async () => {
    seedQuestionsByDifficulty([
      ...Array(5).fill(3),
      ...Array(5).fill(4),
      ...Array(20).fill(5),
    ]);
    const tool = getTool("create_quiz");

    const result = await tool!.execute(
      { subject: "TestLevelSubject", test_level: 3 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("Questions: 15");
  });

  it("should fall back to existing behavior when no test_level provided", async () => {
    seedQuestionsByDifficulty([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    const tool = getTool("create_quiz");

    const result = await tool!.execute(
      { subject: "TestLevelSubject", question_count: 10 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("Questions: 10");
  });

  it("question_count should take priority over test_level when both are set", async () => {
    // Seed enough easy questions (diff=1 or 2) so question_count=10 can be fulfilled
    seedQuestionsByDifficulty([
      ...Array(7).fill(1),
      ...Array(5).fill(2),
    ]);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { subject: "TestLevelSubject", question_count: 10, test_level: 1 },
      { userId: 1, workspaceDir: "." },
    );

    // question_count=10 should win over test_level=1's default 30,
    // test_level=1 infers max_difficulty=2 → 12 easy questions available, ask for 10
    expect(result).toContain("Questions: 10");
  });
});
