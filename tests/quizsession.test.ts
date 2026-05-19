import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  addSubject,
  addKnowledgePoint,
  addQuestion,
  getQuizSessionById,
  getQuizSessionQuestions,
  createQuizSession,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";
import { getTool } from "../src/tools/index.js";
import { getCurrentQuestion, setCurrentQuestion, clearCurrentQuestion } from "../src/agent/questionContext.js";
import "../src/tools/quiz.js";

let testDb: Database.Database;

beforeEach(() => {
  clearCurrentQuestion(1);
  clearCurrentQuestion(2);
});

function seedQuestions(difficulties: number[]): number {
  const subjId = addSubject("SessionTest", null);
  const kpId = addKnowledgePoint(subjId, "SessionTestKP", "test");
  const now = new Date().toISOString();
  const insert = testDb.prepare(
    `INSERT INTO sys_questions (knowledge_point_id, question_text, answer, difficulty, question_type, options, status, created_at)
     VALUES (?, ?, ?, ?, 'multiple_choice', ?, 'published', ?)`
  );
  for (let i = 0; i < difficulties.length; i++) {
    insert.run(kpId, `TestQ ${i} (diff=${difficulties[i]})`, `A${i}`, difficulties[i], JSON.stringify(["A", "B", "C", "D"]), now);
  }
  return subjId;
}

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);
});

describe("P0: create_quiz sets current_question", () => {
  it("should set current_question with sessionId and full question list after create_quiz", async () => {
    seedQuestions([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    const userId = 1;
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    await tool!.execute(
      { subject: "SessionTest", question_count: 5 },
      { userId, workspaceDir: "." },
    );

    const cq = getCurrentQuestion(userId);
    expect(cq).toBeDefined();
    expect(cq!.sessionId).toBeGreaterThan(0);
    expect(cq!.questions).toBeDefined();
    expect(cq!.questions!.length).toBe(5);
    expect(cq!.questions![0].text).toContain("TestQ");
    expect(cq!.questions![0].type).toBe("multiple_choice");
    expect(cq!.questions![0].options).toContain("A");
  });

  it("should allow get_quiz_session to retrieve full question list from current_question", async () => {
    seedQuestions([1, 1, 1, 1, 1]);
    const userId = 1;
    const createTool = getTool("create_quiz");
    expect(createTool).toBeDefined();

    const createResult = await createTool!.execute(
      { subject: "SessionTest", question_count: 3 },
      { userId, workspaceDir: "." },
    );
    expect(createResult).toContain("Session ID:");

    const sessionIdMatch = createResult.match(/Session ID: (\d+)/);
    expect(sessionIdMatch).not.toBeNull();
    const sessionId = parseInt(sessionIdMatch![1], 10);

    const getToolFn = getTool("get_quiz_session");
    expect(getToolFn).toBeDefined();

    const result = await getToolFn!.execute(
      { session_id: sessionId },
      { userId, workspaceDir: "." },
    );

    expect(result).toContain("Session ID:");
    expect(result).toContain("Active");
    expect(result).toContain("Total questions: 3");
    expect(result).toContain("TestQ");
    expect(result).toContain("[multiple_choice]");
    expect(result).toContain("A:");
  });
});

describe("P1: get_quiz_session tool", () => {
  it("should return session info for existing session from DB when current_question is empty", async () => {
    const userId = 1;
    const subjId = seedQuestions([1, 1, 1]);
    const sessionId = createQuizSession(subjId, userId);

    const getToolFn = getTool("get_quiz_session");
    expect(getToolFn).toBeDefined();

    const result = await getToolFn!.execute(
      { session_id: sessionId },
      { userId, workspaceDir: "." },
    );

    expect(result).toContain("Session ID:");
    expect(result).toContain("No answers recorded yet");
  });

  it("should return error for non-existent session", async () => {
    const getToolFn = getTool("get_quiz_session");
    expect(getToolFn).toBeDefined();

    const result = await getToolFn!.execute(
      { session_id: 9999 },
      { userId: 1, workspaceDir: "." },
    );

    expect(result).toContain("not found");
  });

  it("should show answered questions when session has answers", async () => {
    const userId = 1;
    const subjId = seedQuestions([1, 1]);
    const kpId = testDb.prepare(
      "SELECT id FROM sys_knowledgepoints WHERE subject_id = ? LIMIT 1"
    ).get(subjId) as { id: number };

    const sessionId = createQuizSession(subjId, userId);

    const questions = testDb.prepare(
      "SELECT id FROM sys_questions WHERE knowledge_point_id = ? LIMIT 1"
    ).all(kpId.id) as { id: number }[];

    setCurrentQuestion(userId, {
      questionId: questions[0].id,
      questionText: "Test",
      sessionId,
      questions: questions.map(q => ({
        id: q.id, text: `TestQ ${q.id}`, type: "short_answer", options: null,
      })),
      progress: { currentSubIndex: 0, solvedSubIndices: [], userAnswers: {} },
    });

    const answered = testDb.prepare(
      `INSERT INTO user_quizbook (quiz_session_id, subject_id, question_id, student_answer, is_correct, answered_at)
       VALUES (?, ?, ?, 'A', 1, datetime('now'))`
    ).run(sessionId, subjId, questions[0].id);

    const getToolFn = getTool("get_quiz_session");
    const result = await getToolFn!.execute(
      { session_id: sessionId },
      { userId, workspaceDir: "." },
    );

    expect(result).toContain("Your answer: A");
    expect(result).toContain("Correct");
    clearCurrentQuestion(userId);
  });
});

describe("P1: getQuizSessionById and getQuizSessionQuestions", () => {
  it("getQuizSessionById returns session metadata", () => {
    const subjId = addSubject("DBTest", null);
    const sessionId = createQuizSession(subjId, 1);

    const session = getQuizSessionById(sessionId);
    expect(session).toBeDefined();
    expect(session!.id).toBe(sessionId);
    expect(session!.subject_id).toBe(subjId);
    expect(session!.user_id).toBe(1);
    expect(session!.finished_at).toBeNull();
  });

  it("getQuizSessionQuestions returns answered questions with text", () => {
    const subjId = addSubject("DBTest", null);
    const kpId = addKnowledgePoint(subjId, "DBTestKP", "test");
    const now = new Date().toISOString();
    testDb.prepare(
      `INSERT INTO sys_questions (knowledge_point_id, question_text, answer, difficulty, question_type, status, created_at)
       VALUES (?, 'DBTestQ', 'A', 1, 'short_answer', 'published', ?)`
    ).run(kpId, now);

    const q = testDb.prepare(`
      SELECT sq.id FROM sys_questions sq
      JOIN sys_knowledgepoints kp ON kp.id = sq.knowledge_point_id
      WHERE kp.subject_id = ?
    `).get(subjId) as any;
    const sessionId = createQuizSession(subjId, 1);

    testDb.prepare(
      `INSERT INTO user_quizbook (quiz_session_id, subject_id, question_id, student_answer, is_correct, answered_at)
       VALUES (?, ?, ?, 'MyAns', 1, datetime('now'))`
    ).run(sessionId, subjId, q.id);

    const answered = getQuizSessionQuestions(sessionId);
    expect(answered.length).toBe(1);
    expect(answered[0].question_id).toBe(q.id);
    expect(answered[0].question_text).toBe("DBTestQ");
    expect(answered[0].student_answer).toBe("MyAns");
    expect(answered[0].is_correct).toBe(1);
  });

  it("getQuizSessionQuestions returns empty for session with no answers", () => {
    const subjId = addSubject("DBTestEmpty", null);
    const sessionId = createQuizSession(subjId, 1);

    const answered = getQuizSessionQuestions(sessionId);
    expect(answered).toEqual([]);
  });
});

describe("T062: create_quiz 随机性修复", () => {
  function seedManyQuestions(db: Database.Database, count: number): number {
    const subjId = addSubject("RandomTest", null);
    const kpId = addKnowledgePoint(subjId, "RandomTestKP", "test");
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO sys_questions (knowledge_point_id, question_text, answer, difficulty, question_type, options, status, created_at)
       VALUES (?, ?, ?, 1, 'multiple_choice', ?, 'published', ?)`
    );
    for (let i = 0; i < count; i++) {
      insert.run(kpId, `RandomQ ${i}`, `A${i}`, JSON.stringify(["A", "B", "C", "D"]), now);
    }
    return subjId;
  }

  it("P0: 不包含知识点名字的题目也能被抽到（文字过滤已移除）", async () => {
    const subjId = addSubject("NoTextFilter", null);
    const kpId = addKnowledgePoint(subjId, "二次函数", "test");
    const now = new Date().toISOString();
    const insert = testDb.prepare(
      `INSERT INTO sys_questions (knowledge_point_id, question_text, answer, difficulty, question_type, options, status, created_at)
       VALUES (?, ?, ?, 1, 'multiple_choice', ?, 'published', ?)`
    );
    // 10 道题面含"二次函数"，10 道不含（如"抛物线"）
    for (let i = 0; i < 10; i++) {
      insert.run(kpId, `二次函数问题${i}`, `A${i}`, JSON.stringify(["A", "B"]), now);
    }
    for (let i = 0; i < 10; i++) {
      insert.run(kpId, `抛物线问题${i}`, `A${i}`, JSON.stringify(["A", "B"]), now);
    }

    const tool = getTool("create_quiz");
    const result = await tool!.execute(
      { subject: "NoTextFilter", knowledge_point: "二次函数", question_count: 15 },
      { userId: 1, workspaceDir: "." },
    );

    // 20 道题在池中，应返回 15 道，且必须包含"抛物线"开头的题目
    expect(result).toContain("Questions: 15");
    const pqCount = (result.match(/抛物线问题/g) || []).length;
    expect(pqCount).toBeGreaterThan(0);
  });

  it("P1: 两次抽题返回不同子集（pool > question_count）", async () => {
    seedManyQuestions(testDb, 20);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const results = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const result = await tool!.execute(
        { subject: "RandomTest", question_count: 5 },
        { userId: i + 10, workspaceDir: "." },
      );
      // 提取题目 ID 列表
      const ids = (result.match(/ID: (\d+)/g) || []).sort().join(",");
      results.add(ids);
    }

    // 3 次请求应至少产生 2 种不同组合（概率 > 99.9%）
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it("P1: 同用户两次抽题返回不同子集", async () => {
    seedManyQuestions(testDb, 20);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const r1 = await tool!.execute(
      { subject: "RandomTest", question_count: 5 },
      { userId: 99, workspaceDir: "." },
    );
    const r2 = await tool!.execute(
      { subject: "RandomTest", question_count: 5 },
      { userId: 99, workspaceDir: "." },
    );

    const ids1 = (r1.match(/ID: (\d+)/g) || []).sort().join(",");
    const ids2 = (r2.match(/ID: (\d+)/g) || []).sort().join(",");
    expect(ids1).not.toBe(ids2);
  });

  it("P1+2: pool ≤ question_count 时全量返回且顺序可能不同", async () => {
    seedManyQuestions(testDb, 5);
    const tool = getTool("create_quiz");
    expect(tool).toBeDefined();

    const r1 = await tool!.execute(
      { subject: "RandomTest", question_count: 10 },
      { userId: 100, workspaceDir: "." },
    );
    const r2 = await tool!.execute(
      { subject: "RandomTest", question_count: 10 },
      { userId: 100, workspaceDir: "." },
    );

    const qCount1 = (r1.match(/Q\d+\/5/g) || []).length;
    const qCount2 = (r2.match(/Q\d+\/5/g) || []).length;
    // 虽然 pool=5 < 10，但应该正确显示实际题目数
    expect(r1).toContain("Questions: 5");
    expect(r2).toContain("Questions: 5");
    expect(qCount1).toBe(5);
    expect(qCount2).toBe(5);
  });
});
