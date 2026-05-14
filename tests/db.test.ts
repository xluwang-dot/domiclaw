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
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";

let testDb: Database.Database;

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
});
