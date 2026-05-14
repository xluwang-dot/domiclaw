import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  getAllSubjects,
  getSubjectByName,
  addSubject,
  addKnowledgePoint,
  getKnowledgePointById,
  searchKnowledgePoints,
  addQuestion,
  getQuestionById,
  getQuestionsBySubject,
  updateQuestionStats,
  getQuestionDifficulty,
  recordQuizAnswer,
  updateKnowledgePointRelations,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";

let testDb: Database.Database;

function createTestSubject(): number {
  return addSubject("TestSubject", null);
}

function createTestQuestion(subjectId: number, difficulty = 3): number {
  const kpId = addKnowledgePoint(subjectId, "TestKP", "test");
  return addQuestion(null, kpId, "Test question?", "Answer", "short_answer", undefined, difficulty);
}

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);
});

describe("subjects", () => {
  it("seed subjects should exist on empty db", () => {
    const subjects = getAllSubjects();
    expect(subjects.length).toBeGreaterThan(0);
  });

  it("addSubject should create a new subject", () => {
    const id = addSubject("TestChemistry", "The study of matter");
    expect(id).toBeGreaterThan(0);

    const subject = getSubjectByName("TestChemistry");
    expect(subject).toBeDefined();
    expect(subject!.name).toBe("TestChemistry");
    expect(subject!.description).toBe("The study of matter");
  });

  it("getSubjectByName should return undefined for unknown subject", () => {
    const subject = getSubjectByName("NonExistent");
    expect(subject).toBeUndefined();
  });
});

describe("knowledge points", () => {
  it("addKnowledgePoint should create a knowledge point", () => {
    const subjId = addSubject("TestPhysics", null);
    const kpId = addKnowledgePoint(subjId, "Newton's Laws", "Classical mechanics");
    expect(kpId).toBeGreaterThan(0);

    const kp = getKnowledgePointById(kpId);
    expect(kp).toBeDefined();
    expect(kp!.title).toBe("Newton's Laws");
    expect(kp!.content).toBe("Classical mechanics");
  });

  it("searchKnowledgePoints by keyword", () => {
    const subjId = addSubject("TestMath", null);
    addKnowledgePoint(subjId, "Quadratic Function", "ax²+bx+c");
    addKnowledgePoint(subjId, "Linear Equation", "ax+b=0");
    addKnowledgePoint(subjId, "Trigonometry", "sin, cos, tan");

    const results = searchKnowledgePoints("Quadratic");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Quadratic Function");
  });
});

describe("questions", () => {
  it("addQuestion and getQuestionById", () => {
    const qId = addQuestion(
      null, null,
      "What is 2+2?",
      "4",
      "short_answer",
      "Basic addition",
      1,
    );
    expect(qId).toBeGreaterThan(0);

    const q = getQuestionById(qId);
    expect(q).toBeDefined();
    expect(q!.question_text).toBe("What is 2+2?");
    expect(q!.answer).toBe("4");
  });

  it("getQuestionsBySubject with KP association", () => {
    const subjId = addSubject("TestBiology", null);
    const kpId = addKnowledgePoint(subjId, "Cell Division", "mitosis & meiosis");
    addQuestion(null, kpId, "What is mitosis?", "Cell division", "short_answer", undefined, 1);
    addQuestion(null, kpId, "What is meiosis?", "Gamete formation", "short_answer", undefined, 1);

    const questions = getQuestionsBySubject(subjId, 10);
    expect(questions.length).toBe(2);
    questions.forEach((q) => {
      expect(q.knowledge_point_id).toBe(kpId);
  });
});

describe("difficulty tracking — field migration", () => {
  it("should have times_answered and times_correct columns with defaults", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    const row = testDb.prepare(
      "SELECT times_answered, times_correct FROM questions WHERE id = ?"
    ).get(qId) as { times_answered: number; times_correct: number };

    expect(row.times_answered).toBe(0);
    expect(row.times_correct).toBe(0);
  });
});

describe("difficulty tracking — updateQuestionStats", () => {
  it("should increment times_answered on any answer", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    updateQuestionStats(qId, true);
    const row = testDb.prepare("SELECT times_answered FROM questions WHERE id = ?")
      .get(qId) as { times_answered: number };
    expect(row.times_answered).toBe(1);
  });

  it("should increment times_correct on correct answer", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    updateQuestionStats(qId, true);
    const row = testDb.prepare("SELECT times_correct FROM questions WHERE id = ?")
      .get(qId) as { times_correct: number };
    expect(row.times_correct).toBe(1);
  });

  it("should NOT increment times_correct on wrong answer", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    updateQuestionStats(qId, false);
    const row = testDb.prepare("SELECT times_correct FROM questions WHERE id = ?")
      .get(qId) as { times_correct: number };
    expect(row.times_correct).toBe(0);
  });

  it("should accumulate stats across multiple answers", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    for (let i = 0; i < 3; i++) updateQuestionStats(qId, true);
    for (let i = 0; i < 2; i++) updateQuestionStats(qId, false);

    const row = testDb.prepare(
      "SELECT times_answered, times_correct FROM questions WHERE id = ?"
    ).get(qId) as { times_answered: number; times_correct: number };

    expect(row.times_answered).toBe(5);
    expect(row.times_correct).toBe(3);
  });
});

describe("difficulty tracking — getQuestionDifficulty", () => {
  it("should return initial difficulty when no answers recorded", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    const diff = getQuestionDifficulty(qId);
    expect(diff).toBe(3);
  });

  it("should blend empirical data with initial difficulty", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 5);

    // 10 answers, 3 correct → empirical = 1 - 3/10 = 0.7
    for (let i = 0; i < 3; i++) updateQuestionStats(qId, true);
    for (let i = 0; i < 7; i++) updateQuestionStats(qId, false);

    // credibility = 10/20 = 0.5
    // difficulty = (1-0.5) * 5 + 0.5 * 0.7 = 2.5 + 0.35 = 2.85
    const diff = getQuestionDifficulty(qId);
    expect(diff).toBeCloseTo(0.5 * 5 + 0.5 * 0.7, 4);
  });

  it("should converge to empirical difficulty with 20+ answers", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 5);

    // 20 answers, 15 correct → empirical = 1 - 15/20 = 0.25
    for (let i = 0; i < 15; i++) updateQuestionStats(qId, true);
    for (let i = 0; i < 5; i++) updateQuestionStats(qId, false);

    // credibility = min(20/20, 1) = 1
    // difficulty = 0 * 5 + 1 * 0.25 = 0.25
    const diff = getQuestionDifficulty(qId);
    expect(diff).toBeCloseTo(0.25, 4);
  });

  it("should return ~1.0 when all answers wrong", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    for (let i = 0; i < 20; i++) updateQuestionStats(qId, false);

    const diff = getQuestionDifficulty(qId);
    expect(diff).toBeGreaterThanOrEqual(0.95);
  });

  it("should return ~0.0 when all answers correct", () => {
    const subjId = createTestSubject();
    const qId = createTestQuestion(subjId, 3);

    for (let i = 0; i < 20; i++) updateQuestionStats(qId, true);

    const diff = getQuestionDifficulty(qId);
    expect(diff).toBeLessThanOrEqual(0.1);
  });

  it("should handle non-existent question gracefully", () => {
    const diff = getQuestionDifficulty(99999);
    expect(diff).toBeDefined();
    expect(typeof diff).toBe("number");
  });
});

describe("kp relations — prerequisite_ids / related_ids", () => {
  it("should have prerequisite_ids and related_ids columns with NULL default", () => {
    const subjId = addSubject("TestKPRel", null);
    const kpId = addKnowledgePoint(subjId, "Test KP", "test content");

    const row = testDb.prepare(
      "SELECT prerequisite_ids, related_ids FROM knowledge_points WHERE id = ?"
    ).get(kpId) as { prerequisite_ids: string | null; related_ids: string | null };

    expect(row.prerequisite_ids).toBeNull();
    expect(row.related_ids).toBeNull();
  });

  it("should store and retrieve prerequisite_ids", () => {
    const subjId = addSubject("TestKPRel2", null);
    const kpId = addKnowledgePoint(subjId, "KP with prereqs", "content",
      undefined, undefined, undefined, undefined, "[1, 2, 3]", undefined);

    const kp = getKnowledgePointById(kpId);
    expect(kp).toBeDefined();
    expect(kp!.prerequisite_ids).toBe("[1, 2, 3]");
  });

  it("should store and retrieve related_ids", () => {
    const subjId = addSubject("TestKPRel3", null);
    const kpId = addKnowledgePoint(subjId, "KP with related", "content",
      undefined, undefined, undefined, undefined, undefined, "[5, 8, 13]");

    const kp = getKnowledgePointById(kpId);
    expect(kp).toBeDefined();
    expect(kp!.related_ids).toBe("[5, 8, 13]");
  });

  it("should update relations via updateKnowledgePointRelations", () => {
    const subjId = addSubject("TestKPRel4", null);
    const kpId = addKnowledgePoint(subjId, "KP to update", "content");

    updateKnowledgePointRelations(kpId, "[10, 20]", "[30, 40]");
    const kp = getKnowledgePointById(kpId);
    expect(kp!.prerequisite_ids).toBe("[10, 20]");
    expect(kp!.related_ids).toBe("[30, 40]");
  });

  it("should clear relations when set to null", () => {
    const subjId = addSubject("TestKPRel5", null);
    const kpId = addKnowledgePoint(subjId, "KP to clear", "content",
      undefined, undefined, undefined, undefined, "[1, 2]", "[3, 4]");

    updateKnowledgePointRelations(kpId, null, null);
    const kp = getKnowledgePointById(kpId);
    expect(kp!.prerequisite_ids).toBeNull();
    expect(kp!.related_ids).toBeNull();
  });
});
});
