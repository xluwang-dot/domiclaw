import Database from "better-sqlite3";
import { createSchema, useTestDatabase } from "../src/db.js";
import { initAuthDb } from "../src/auth.js";

/**
 * 创建测试数据库（:memory: 模式），每次调用返回全新实例
 */
export function createTestDatabase(): Database.Database {
  const testDb = new Database(":memory:");

  // 建业务表
  createSchema(testDb);

  // 建用户表
  initAuthDb(testDb);

  // 注入到模块内部，使所有 db.ts 函数使用该测试数据库
  useTestDatabase(testDb);

  return testDb;
}

/**
 * 在测试套件中插入一个测试用户，返回 userId
 */
export function insertTestUser(
  db: Database.Database,
  username = "test_student",
  role: "student" | "admin" = "student",
): number {
  const hash = "$2b$10$dummy"; // not used in tests
  const result = db
    .prepare(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(username, hash, role, new Date().toISOString());
  return result.lastInsertRowid as number;
}

/**
 * 在测试套件中插入一个测试科目，返回 subjectId
 */
export function insertTestSubject(
  db: Database.Database,
  name = "TestSubject",
): number {
  const result = db
    .prepare(
      "INSERT INTO subjects (name, created_at) VALUES (?, ?)",
    )
    .run(name, new Date().toISOString());
  return result.lastInsertRowid as number;
}

/**
 * 在测试套件中插入一个测试知识点，返回 kpId
 */
export function insertTestKnowledgePoint(
  db: Database.Database,
  subjectId: number,
  title: string,
  parentId: number | null = null,
): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO knowledge_points (subject_id, parent_id, title, content, level_type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'knowledge_point', 0, ?, ?)`,
    )
    .run(subjectId, parentId, title, title, now, now);
  return result.lastInsertRowid as number;
}

/**
 * 在测试套件中插入一个测试题目，返回 questionId
 */
export function insertTestQuestion(
  db: Database.Database,
  questionText: string,
  answer: string,
  kpId: number | null = null,
  difficulty = 1,
): number {
  const result = db
    .prepare(
      `INSERT INTO questions (knowledge_point_id, question_text, answer, difficulty, question_type, status, created_at)
       VALUES (?, ?, ?, ?, 'short_answer', 'published', ?)`,
    )
    .run(kpId, questionText, answer, difficulty, new Date().toISOString());
  return result.lastInsertRowid as number;
}
