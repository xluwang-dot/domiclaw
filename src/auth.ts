import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

import { ADMIN_USERNAME, ADMIN_PASSWORD } from "./config.js";
import { logger } from "./logger.js";

const BCRYPT_ROUNDS = 10;

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: "student" | "admin";
  created_at: string;
  last_active: string | null;
  active_session_id: string | null;
}

let db: Database.Database;

export function initAuthDb(database: Database.Database): void {
  db = database;

  db.exec(`
    CREATE TABLE IF NOT EXISTS sys_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TEXT NOT NULL,
      last_active TEXT,
      active_session_id TEXT
    );
  `);

  createDefaultAdmin();
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function createUser(
  username: string,
  password: string,
  role: "student" | "admin" = "student",
): number {
  const hash = hashPassword(password);
  const result = db.prepare(
    `INSERT INTO sys_users (username, password_hash, role, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(username, hash, role, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM sys_users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getUserByUsername(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM sys_users WHERE username = ?").get(username) as UserRow | undefined;
}

export function createDefaultAdmin(): void {
  if (!ADMIN_PASSWORD) {
    logger.fatal("ADMIN_PASSWORD is not set — cannot create default admin");
    process.exit(1);
  }

  const count = (db.prepare("SELECT COUNT(*) as cnt FROM sys_users").get() as { cnt: number }).cnt;
  if (count === 0) {
    createUser(ADMIN_USERNAME, ADMIN_PASSWORD, "admin");
    logger.info({ username: ADMIN_USERNAME }, "Default admin user created");
  }
}

export function updateActiveSession(userId: number, sessionId: string): void {
  db.prepare(
    `UPDATE sys_users SET active_session_id = ?, last_active = ? WHERE id = ?`,
  ).run(sessionId, new Date().toISOString(), userId);
}

export function clearActiveSession(userId: number): void {
  db.prepare(
    `UPDATE sys_users SET active_session_id = NULL WHERE id = ?`,
  ).run(userId);
}

export function getUserBySessionId(sessionId: string): UserRow | undefined {
  return db.prepare(
    "SELECT * FROM sys_users WHERE active_session_id = ?",
  ).get(sessionId) as UserRow | undefined;
}

// Admin: list all users with stats
export function getAllUsers(): (UserRow & {
  quiz_count: number;
  total_answers: number;
  correct_answers: number;
  active_wrong: number;
})[] {
  return db.prepare(`
    SELECT u.*,
      COALESCE(qs.quiz_count, 0) as quiz_count,
      COALESCE(qa.total_answers, 0) as total_answers,
      COALESCE(qa.correct_answers, 0) as correct_answers,
      COALESCE(wq.active_wrong, 0) as active_wrong
    FROM sys_users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) as quiz_count FROM user_quizsessions GROUP BY user_id
    ) qs ON u.id = qs.user_id
    LEFT JOIN (
      SELECT qs2.user_id, COUNT(*) as total_answers,
        COALESCE(SUM(qa2.is_correct), 0) as correct_answers
      FROM user_quizbook qa2
      JOIN user_quizsessions qs2 ON qa2.quiz_session_id = qs2.id
      GROUP BY qs2.user_id
    ) qa ON u.id = qa.user_id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as active_wrong
      FROM user_wrongquestions WHERE mastered = 0 GROUP BY user_id
    ) wq ON u.id = wq.user_id
    ORDER BY u.created_at
  `).all() as (UserRow & {
    quiz_count: number;
    total_answers: number;
    correct_answers: number;
    active_wrong: number;
  })[];
}

export function searchUsers(search?: string, page = 1, limit = 20): {
  users: (UserRow & { quiz_count: number; total_answers: number; correct_answers: number; active_wrong: number })[];
  total: number;
} {
  const like = search ? `%${search}%` : null;
  const where = like ? "WHERE u.username LIKE ? OR u.role LIKE ?" : "";
  const params = like ? [like, like] : [];

  const totalRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM sys_users u ${where}`,
  ).get(...params) as { cnt: number };

  const users = db.prepare(`
    SELECT u.*,
      COALESCE(qs.quiz_count, 0) as quiz_count,
      COALESCE(qa.total_answers, 0) as total_answers,
      COALESCE(qa.correct_answers, 0) as correct_answers,
      COALESCE(wq.active_wrong, 0) as active_wrong
    FROM sys_users u
    LEFT JOIN (SELECT user_id, COUNT(*) as quiz_count FROM user_quizsessions GROUP BY user_id) qs ON u.id = qs.user_id
    LEFT JOIN (
      SELECT qs2.user_id, COUNT(*) as total_answers, COALESCE(SUM(qa2.is_correct), 0) as correct_answers
      FROM user_quizbook qa2 JOIN user_quizsessions qs2 ON qa2.quiz_session_id = qs2.id GROUP BY qs2.user_id
    ) qa ON u.id = qa.user_id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as active_wrong FROM user_wrongquestions WHERE mastered = 0 GROUP BY user_id
    ) wq ON u.id = wq.user_id
    ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit) as (UserRow & {
    quiz_count: number; total_answers: number; correct_answers: number; active_wrong: number;
  })[];

  return { users, total: totalRow.cnt };
}

export function resetUserPassword(userId: number, newHash: string): boolean {
  const result = db.prepare(
    "UPDATE sys_users SET password_hash = ?, active_session_id = NULL WHERE id = ?",
  ).run(newHash, userId);
  return result.changes > 0;
}
