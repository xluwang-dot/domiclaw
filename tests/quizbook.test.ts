import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  addSubject,
  addKnowledgePoint,
  addQuestion,
  createQuizSession,
  recordQuizAnswer,
  getQuizSessionAnswers,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";

let testDb: Database.Database;
let sessionId: number;
let questionId: number;

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);

  const subjId = addSubject("TestQuizbook", null);
  const kpId = addKnowledgePoint(subjId, "TestKP", "test");
  questionId = addQuestion(kpId, "Test Q?", "Answer", "short_answer", undefined, 1);
  sessionId = createQuizSession(subjId, 1);
});

describe("user_quizbook — table structure", () => {
  it("should have all expected columns with defaults", () => {
    recordQuizAnswer(sessionId, 1, questionId, "my answer", true);

    const row = testDb.prepare(
      `SELECT id, quiz_session_id, question_id, subject_id, student_answer, is_correct,
              solution_steps, duration_seconds, error_reason
       FROM user_quizbook WHERE quiz_session_id = ?`
    ).get(sessionId) as Record<string, unknown>;

    expect(row).toBeDefined();
    expect(row.student_answer).toBe("my answer");
    expect(row.is_correct).toBe(1);
    // New columns should default to NULL
    expect(row.solution_steps).toBeNull();
    expect(row.duration_seconds).toBeNull();
    expect(row.error_reason).toBeNull();
  });

  it("should store and retrieve new fields", () => {
    testDb.prepare(`
      INSERT INTO user_quizbook (quiz_session_id, question_id, subject_id, student_answer, is_correct, answered_at, solution_steps, duration_seconds, error_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, questionId, 1, "my answer", 1, new Date().toISOString(), "step1→step2→wrong", 45, "计算失误");

    const row = testDb.prepare(
      "SELECT solution_steps, duration_seconds, error_reason FROM user_quizbook WHERE quiz_session_id = ?"
    ).get(sessionId) as { solution_steps: string; duration_seconds: number; error_reason: string };

    expect(row.solution_steps).toBe("step1→step2→wrong");
    expect(row.duration_seconds).toBe(45);
    expect(row.error_reason).toBe("计算失误");
  });
});

describe("user_quizbook — recordQuizAnswer", () => {
  it("should create a record in user_quizbook", () => {
    recordQuizAnswer(sessionId, 1, questionId, "42", true);

    const answers = getQuizSessionAnswers(sessionId);
    expect(answers.length).toBe(1);
    expect(answers[0].student_answer).toBe("42");
    expect(answers[0].is_correct).toBe(1);
  });

  it("should handle multiple answers in same session", () => {
    const qId2 = addQuestion(null, "Second Q?", "Ans2", "short_answer", undefined, 1);
    recordQuizAnswer(sessionId, 1, questionId, "first", true);
    recordQuizAnswer(sessionId, 1, qId2, "second", false);

    const answers = getQuizSessionAnswers(sessionId);
    expect(answers.length).toBe(2);
  });
});
