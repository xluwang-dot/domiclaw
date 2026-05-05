import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { STORE_DIR } from "./config.js";
import { logger } from "./logger.js";
import { initAuthDb } from "./auth.js";
import { NewMessage } from "./types.js";

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_cn TEXT,
      alias TEXT,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      parent_id INTEGER REFERENCES knowledge_points(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      level_type TEXT NOT NULL DEFAULT 'knowledge_point',
      sort_order INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subject_id) REFERENCES subjects(id),
      UNIQUE(parent_id, title)
    );

    CREATE TABLE IF NOT EXISTS exam_papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      total_score INTEGER DEFAULT 100,
      duration_minutes INTEGER DEFAULT 60,
      exam_date TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_paper_id INTEGER,
      knowledge_point_id INTEGER,
      knowledge_point_ids TEXT,
      question_text TEXT NOT NULL,
      answer TEXT NOT NULL,
      explanation TEXT,
      difficulty INTEGER DEFAULT 1,
      question_type TEXT NOT NULL DEFAULT 'short_answer',
      options TEXT,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      FOREIGN KEY (exam_paper_id) REFERENCES exam_papers(id),
      FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
    );

    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      total_questions INTEGER DEFAULT 0,
      correct_count INTEGER DEFAULT 0,
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_qs_user ON quiz_sessions(user_id);

    CREATE TABLE IF NOT EXISTS quiz_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_session_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL DEFAULT 0,
      student_answer TEXT,
      is_correct INTEGER DEFAULT 0,
      weak_kp_ids TEXT,
      answered_at TEXT NOT NULL,
      FOREIGN KEY (quiz_session_id) REFERENCES quiz_sessions(id),
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );

    CREATE TABLE IF NOT EXISTS wrong_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL DEFAULT 0,
      root_kp_id INTEGER,
      wrong_count INTEGER DEFAULT 1,
      consecutive_correct INTEGER DEFAULT 0,
      last_reviewed_at TEXT NOT NULL,
      next_review_at TEXT NOT NULL,
      review_interval_days INTEGER DEFAULT 1,
      mastered INTEGER DEFAULT 0,
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wq_next_review ON wrong_questions(next_review_at);
    CREATE INDEX IF NOT EXISTS idx_wq_user ON wrong_questions(user_id);

    CREATE TABLE IF NOT EXISTS study_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject_id INTEGER,
      title TEXT NOT NULL,
      plan_data TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sp_user ON study_plans(user_id);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_st_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_st_user ON scheduled_tasks(user_id);

    CREATE TABLE IF NOT EXISTS session_context (
      user_id INTEGER PRIMARY KEY,
      topic TEXT,
      weak_areas TEXT,
      summary TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_kp_mastery (
      user_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      kp_id INTEGER NOT NULL,
      mastery REAL NOT NULL DEFAULT 0.5,
      last_updated TEXT NOT NULL,
      PRIMARY KEY (user_id, subject_id, kp_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ukm_user ON user_kp_mastery(user_id);
    CREATE INDEX IF NOT EXISTS idx_ukm_kp ON user_kp_mastery(kp_id);

    CREATE TABLE IF NOT EXISTS user_kp_weakness (
      user_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      kp_id INTEGER NOT NULL,
      total_wrong INTEGER DEFAULT 1,
      representative_question_id INTEGER,
      last_wrong_time TEXT,
      PRIMARY KEY (user_id, subject_id, kp_id)
    );
  `);

  // Seed common subjects on first run
  const count = database.prepare(
    "SELECT COUNT(*) as cnt FROM subjects",
  ).get() as { cnt: number };
  if (count.cnt === 0) {
    const now = new Date().toISOString();
    const subjects: { name: string; name_cn: string | null; alias: string | null }[] = [
      { name: "Mathematics", name_cn: "数学", alias: null },
      { name: "Physics", name_cn: "物理", alias: null },
      { name: "Chemistry", name_cn: "化学", alias: null },
      { name: "Biology", name_cn: "生物", alias: null },
      { name: "English", name_cn: "英语", alias: null },
      { name: "Chinese", name_cn: "语文", alias: null },
      { name: "History", name_cn: "历史", alias: null },
      { name: "Geography", name_cn: "地理", alias: null },
      { name: "Politics", name_cn: "政治", alias: "道法" },
    ];
    const insert = database.prepare(
      "INSERT INTO subjects (name, name_cn, alias, description, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const s of subjects) {
      insert.run(s.name, s.name_cn, s.alias, null, now);
    }
  }
}

// Level compatibility: parent → allowed children
const LEVEL_RULES: Record<string, string[]> = {
  "root": ["module", "domain", "unit", "chapter", "section", "knowledge_point"],
  "module": ["chapter", "section", "knowledge_point"],
  "domain": ["chapter", "section", "knowledge_point"],
  "unit": ["chapter", "section", "knowledge_point"],
  "chapter": ["knowledge_point"],
  "section": ["knowledge_point"],
  "knowledge_point": [], // leaf — no children
};

export function validateKnowledgePointLevel(
  parentLevelType: string | null,
  childLevelType: string,
): { ok: boolean; error?: string } {
  if (!parentLevelType) return { ok: true }; // root can have any level_type as child
  const allowed = LEVEL_RULES[parentLevelType];
  if (!allowed) return { ok: false, error: `Unknown parent level_type: ${parentLevelType}` };
  if (!allowed.includes(childLevelType)) {
    return { ok: false, error: `"${parentLevelType}" cannot contain "${childLevelType}". Allowed: ${allowed.join(", ")}` };
  }
  return { ok: true };
}

function ensureRootKnowledgePoints(database: Database.Database): void {
  const subjects = database.prepare("SELECT id, name, name_cn FROM subjects").all() as { id: number; name: string; name_cn: string | null }[];
  const exists = database.prepare(
    "SELECT 1 FROM knowledge_points WHERE subject_id = ? AND parent_id IS NULL AND level_type = 'root'",
  );
  const insert = database.prepare(
    `INSERT INTO knowledge_points (subject_id, parent_id, title, content, level_type, sort_order, created_at)
     VALUES (?, NULL, ?, ?, 'root', 0, ?)`,
  );
  const now = new Date().toISOString();
  for (const s of subjects) {
    if (!exists.get(s.id)) {
      const title = s.name_cn || s.name;
      insert.run(s.id, title, `${title} 学科根节点`, now);
    }
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, "messages.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // Create all tables
  createSchema(db);

  // Incremental migrations: add columns to existing tables (idempotent via try/catch)
  for (const stmt of [
    `ALTER TABLE questions ADD COLUMN user_id INTEGER REFERENCES users(id)`,
    `ALTER TABLE questions ADD COLUMN knowledge_point_ids TEXT`,
    `ALTER TABLE quiz_answers ADD COLUMN weak_kp_ids TEXT`,
    `ALTER TABLE quiz_answers ADD COLUMN subject_id INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE wrong_questions ADD COLUMN root_kp_id INTEGER`,
    `ALTER TABLE wrong_questions ADD COLUMN subject_id INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE knowledge_points ADD COLUMN parent_id INTEGER REFERENCES knowledge_points(id)`,
    `ALTER TABLE knowledge_points ADD COLUMN level_type TEXT NOT NULL DEFAULT 'knowledge_point'`,
    `ALTER TABLE knowledge_points ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE subjects ADD COLUMN name_cn TEXT`,
    `ALTER TABLE subjects ADD COLUMN alias TEXT`,
  ]) {
    try { db.exec(stmt); } catch { /* column already exists — skip */ }
  }
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_questions_user ON questions(user_id)"); } catch { /* ok */ }
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_kp_parent ON knowledge_points(parent_id)"); } catch { /* ok */ }
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_parent_title ON knowledge_points(parent_id, title) WHERE parent_id IS NOT NULL"); } catch { /* ok */ }

  // Rebuild user_kp_mastery with (user_id, subject_id, kp_id) PK if needed
  const masteryCols = db.prepare("PRAGMA table_info(user_kp_mastery)").all() as { name: string }[];
  if (!masteryCols.some((c) => c.name === "subject_id")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_kp_mastery_new (
        user_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        kp_id INTEGER NOT NULL,
        mastery REAL NOT NULL DEFAULT 0.5,
        last_updated TEXT NOT NULL,
        PRIMARY KEY (user_id, subject_id, kp_id)
      );
      INSERT OR IGNORE INTO user_kp_mastery_new (user_id, subject_id, kp_id, mastery, last_updated)
        SELECT m.user_id, COALESCE(kp.subject_id, 0), m.kp_id, m.mastery, m.last_updated
        FROM user_kp_mastery m LEFT JOIN knowledge_points kp ON m.kp_id = kp.id;
      DROP TABLE user_kp_mastery;
      ALTER TABLE user_kp_mastery_new RENAME TO user_kp_mastery;
      CREATE INDEX IF NOT EXISTS idx_ukm_user ON user_kp_mastery(user_id);
      CREATE INDEX IF NOT EXISTS idx_ukm_kp ON user_kp_mastery(kp_id);
    `);
  }

  // Rebuild user_kp_weakness with (user_id, subject_id, kp_id) PK if needed
  const weaknessCols = db.prepare("PRAGMA table_info(user_kp_weakness)").all() as { name: string }[];
  if (!weaknessCols.some((c) => c.name === "subject_id")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_kp_weakness_new (
        user_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        kp_id INTEGER NOT NULL,
        total_wrong INTEGER DEFAULT 1,
        representative_question_id INTEGER,
        last_wrong_time TEXT,
        PRIMARY KEY (user_id, subject_id, kp_id)
      );
      INSERT OR IGNORE INTO user_kp_weakness_new (user_id, subject_id, kp_id, total_wrong, representative_question_id, last_wrong_time)
        SELECT w.user_id, COALESCE(kp.subject_id, 0), w.kp_id, w.total_wrong, w.representative_question_id, w.last_wrong_time
        FROM user_kp_weakness w LEFT JOIN knowledge_points kp ON w.kp_id = kp.id;
      DROP TABLE user_kp_weakness;
      ALTER TABLE user_kp_weakness_new RENAME TO user_kp_weakness;
    `);
  }

  // Seed name_cn/alias for existing subjects (idempotent)
  const nameCnMap: Record<string, { name_cn: string; alias: string | null }> = {
    "Mathematics": { name_cn: "数学", alias: null },
    "Physics": { name_cn: "物理", alias: null },
    "Chemistry": { name_cn: "化学", alias: null },
    "Biology": { name_cn: "生物", alias: null },
    "English": { name_cn: "英语", alias: null },
    "Chinese": { name_cn: "语文", alias: null },
    "History": { name_cn: "历史", alias: null },
    "Geography": { name_cn: "地理", alias: null },
    "Politics": { name_cn: "政治", alias: "道法" },
  };
  const updateSubject = db.prepare(
    "UPDATE subjects SET name_cn = ?, alias = ? WHERE name = ? AND name_cn IS NULL",
  );
  for (const [name, info] of Object.entries(nameCnMap)) {
    updateSubject.run(info.name_cn, info.alias, name);
  }

  // Create root KP nodes for existing subjects that lack one (idempotent)
  ensureRootKnowledgePoints(db);

  // Init auth module
  initAuthDb(db);
}

// ============== Message queries ==============

export function storeMessage(msg: NewMessage, userId: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages
     (id, user_id, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id, userId, msg.sender, msg.sender_name,
    msg.content, msg.timestamp,
    msg.is_from_me ? 1 : 0, msg.is_bot_message ? 1 : 0,
  );
}

export function getMessagesSince(
  userId: number, afterTimestamp: string,
  assistantName: string, limit: number,
): NewMessage[] {
  let query = `
    SELECT id, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages WHERE user_id = ? AND timestamp > ?
  `;
  const params: (number | string)[] = [userId, afterTimestamp];
  query += ` ORDER BY timestamp ASC LIMIT ?`;
  params.push(limit);
  return db.prepare(query).all(...params) as NewMessage[];
}

// ============== Subject queries ==============

export interface SubjectRow {
  id: number; name: string; name_cn: string | null; alias: string | null; description: string | null;
}

export function getAllSubjects(): SubjectRow[] {
  return db.prepare(
    "SELECT id, name, name_cn, alias, description FROM subjects ORDER BY name",
  ).all() as SubjectRow[];
}

export function getSubjectByName(name: string): SubjectRow | undefined {
  return db.prepare(
    "SELECT id, name, name_cn, alias, description FROM subjects WHERE name = ?",
  ).get(name) as SubjectRow | undefined;
}

export function addSubject(
  name: string, description: string | null,
  nameCn: string | null = null, alias: string | null = null,
): number {
  const result = db.prepare(
    "INSERT INTO subjects (name, name_cn, alias, description, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(name, nameCn, alias, description, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function updateSubject(id: number, name: string, description: string | null): boolean {
  const result = db.prepare(
    "UPDATE subjects SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
  ).run(name, description, id);
  return result.changes > 0;
}

export function deleteSubject(id: number): boolean {
  const result = db.prepare("DELETE FROM subjects WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============== Knowledge point queries ==============

export interface KnowledgePointRow {
  id: number; subject_id: number; parent_id: number | null;
  title: string; content: string; level_type: string;
  sort_order: number; tags: string | null;
}

export function addKnowledgePoint(
  subjectId: number, title: string, content: string,
  parentId?: number | null, levelType?: string, sortOrder?: number, tags?: string,
): number {
  const result = db.prepare(
    `INSERT INTO knowledge_points (subject_id, parent_id, title, content, level_type, sort_order, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(subjectId, parentId || null, title, content, levelType || "knowledge_point", sortOrder || 0, tags || null, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function searchKnowledgePoints(query: string, subjectId?: number): KnowledgePointRow[] {
  const like = `%${query}%`;
  const cols = "id, subject_id, parent_id, title, content, level_type, sort_order, tags";
  if (subjectId) {
    return db.prepare(
      `SELECT ${cols} FROM knowledge_points
       WHERE (title LIKE ? OR content LIKE ? OR tags LIKE ?) AND subject_id = ?
       ORDER BY level_type, sort_order, title LIMIT 20`,
    ).all(like, like, like, subjectId) as KnowledgePointRow[];
  }
  return db.prepare(
    `SELECT ${cols} FROM knowledge_points
     WHERE title LIKE ? OR content LIKE ? OR tags LIKE ?
     ORDER BY level_type, sort_order, title LIMIT 20`,
  ).all(like, like, like) as KnowledgePointRow[];
}

export function getKnowledgePointById(id: number): KnowledgePointRow | undefined {
  return db.prepare(
    "SELECT id, subject_id, parent_id, title, content, level_type, sort_order, tags FROM knowledge_points WHERE id = ?",
  ).get(id) as KnowledgePointRow | undefined;
}

export function getKnowledgePointsBySubject(subjectId: number): KnowledgePointRow[] {
  return db.prepare(
    `SELECT id, subject_id, parent_id, title, content, level_type, sort_order, tags
     FROM knowledge_points WHERE subject_id = ?
     ORDER BY level_type, sort_order, title`,
  ).all(subjectId) as KnowledgePointRow[];
}

export function getAllKnowledgePoints(): KnowledgePointRow[] {
  return db.prepare(
    `SELECT id, subject_id, parent_id, title, content, level_type, sort_order, tags
     FROM knowledge_points ORDER BY subject_id, level_type, sort_order, title`,
  ).all() as KnowledgePointRow[];
}

export function updateKnowledgePoint(
  id: number, title?: string, content?: string, tags?: string | null,
  parentId?: number | null, levelType?: string, sortOrder?: number,
): boolean {
  const result = db.prepare(
    `UPDATE knowledge_points
     SET title = COALESCE(?, title), content = COALESCE(?, content),
         tags = COALESCE(?, tags), parent_id = COALESCE(?, parent_id),
         level_type = COALESCE(?, level_type), sort_order = COALESCE(?, sort_order)
     WHERE id = ?`,
  ).run(
    title || null, content || null, tags !== undefined ? tags : null,
    parentId !== undefined ? (parentId ?? null) : null,
    levelType || null, sortOrder ?? null, id,
  );
  return result.changes > 0;
}

export function deleteKnowledgePoint(id: number): boolean {
  const result = db.prepare("DELETE FROM knowledge_points WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============== Exam paper queries ==============

export function addExamPaper(
  subjectId: number, title: string, examDate?: string,
  totalScore?: number, durationMinutes?: number,
): number {
  const result = db.prepare(
    `INSERT INTO exam_papers (subject_id, title, total_score, duration_minutes, exam_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(subjectId, title, totalScore || 100, durationMinutes || 60, examDate || null, new Date().toISOString());
  return result.lastInsertRowid as number;
}

// ============== Question queries ==============

export function addQuestion(
  examPaperId: number | null, knowledgePointId: number | null,
  questionText: string, answer: string, questionType: string,
  explanation?: string, difficulty?: number, options?: string,
  knowledgePointIds?: string,
): number {
  const result = db.prepare(
    `INSERT INTO questions (exam_paper_id, knowledge_point_id, knowledge_point_ids,
       question_text, answer, explanation, difficulty, question_type, options, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(examPaperId, knowledgePointId, knowledgePointIds || null, questionText, answer,
    explanation || null, difficulty || 1, questionType, options || null, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export interface QuestionRow {
  id: number;
  question_text: string;
  answer: string;
  explanation: string | null;
  difficulty: number;
  question_type: string;
  options: string | null;
  knowledge_point_id: number | null;
  knowledge_point_ids: string | null;
  status?: string;
  exam_paper_id?: number | null;
}

export function getQuestionsBySubject(subjectId: number, limit = 50): QuestionRow[] {
  return db.prepare(
    `SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type,
            q.options, q.knowledge_point_id, q.knowledge_point_ids
     FROM questions q
     LEFT JOIN exam_papers ep ON q.exam_paper_id = ep.id
     LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
     WHERE (ep.subject_id = ? OR kp.subject_id = ?) AND q.status = 'published'
     LIMIT 500`,
  ).all(subjectId, subjectId) as QuestionRow[];
}

export function getQuestionsByKnowledgePoint(knowledgePointId: number): QuestionRow[] {
  return db.prepare(
    `SELECT id, question_text, answer, explanation, difficulty, question_type,
            options, knowledge_point_id, knowledge_point_ids
     FROM questions WHERE knowledge_point_id = ? AND status = 'published'`,
  ).all(knowledgePointId) as QuestionRow[];
}

export function getQuestionsForKpQuiz(
  kpId: number,
  userId: number,
  limit: number,
  excludeIds?: number[],
): QuestionRow[] {
  let query = `
    SELECT id, question_text, answer, explanation, difficulty, question_type,
           options, knowledge_point_id
    FROM questions
    WHERE knowledge_point_id = ?
      AND (user_id IS NULL OR user_id = ?)
      AND status = 'published'
  `;
  const params: (number | string)[] = [kpId, userId];
  if (excludeIds && excludeIds.length > 0) {
    query += ` AND id NOT IN (${excludeIds.map(() => "?").join(",")})`;
    params.push(...excludeIds);
  }
  query += ` ORDER BY RANDOM() LIMIT ?`;
  params.push(limit);
  return db.prepare(query).all(...params) as QuestionRow[];
}

export function updateQuestionExplanation(id: number, explanation: string): void {
  db.prepare("UPDATE questions SET explanation = ? WHERE id = ?").run(explanation, id);
}

export function getQuestionById(id: number): QuestionRow | undefined {
  return db.prepare(
    `SELECT id, question_text, answer, explanation, difficulty, question_type,
            options, knowledge_point_id
     FROM questions WHERE id = ?`,
  ).get(id) as QuestionRow | undefined;
}


export function updateQuestion(id: number, fields: Record<string, unknown>): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const allowed = ["question_text", "answer", "explanation", "difficulty",
      "question_type", "options", "status", "exam_paper_id", "knowledge_point_id"];
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return false;
  vals.push(id);
  const result = db.prepare(
    `UPDATE questions SET ${sets.join(", ")} WHERE id = ?`,
  ).run(...vals);
  return result.changes > 0;
}

export function deleteQuestion(id: number): boolean {
  const result = db.prepare("DELETE FROM questions WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============== User-private question queries ==============

export function addUserQuestion(
  userId: number,
  questionText: string,
  answer: string,
  questionType: string,
  explanation?: string,
  difficulty?: number,
  options?: string,
  kpId?: number,
  examPaperId?: number,
): number {
  const result = db.prepare(
    `INSERT INTO questions (user_id, exam_paper_id, knowledge_point_id, question_text, answer,
       explanation, difficulty, question_type, options, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
  ).run(userId, examPaperId || null, kpId || null, questionText, answer,
    explanation || null, difficulty || 1, questionType, options || null,
    new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function getUserQuestions(
  userId: number,
  opts?: { kpId?: number; type?: string; difficulty?: number; page?: number; limit?: number },
): { questions: QuestionRow[]; total: number } {
  const page = Math.max(1, opts?.page || 1);
  const limit = Math.min(100, Math.max(1, opts?.limit || 20));
  const conditions: string[] = ["q.user_id = ?"];
  const params: unknown[] = [userId];

  if (opts?.kpId) {
    conditions.push("q.knowledge_point_id = ?");
    params.push(opts.kpId);
  }
  if (opts?.type) {
    conditions.push("q.question_type = ?");
    params.push(opts.type);
  }
  if (opts?.difficulty) {
    conditions.push("q.difficulty = ?");
    params.push(opts.difficulty);
  }

  const where = conditions.join(" AND ");

  const totalRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM questions q WHERE ${where}`,
  ).get(...params) as { cnt: number };

  const questions = db.prepare(
    `SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type,
            q.options, q.knowledge_point_id, q.status, q.exam_paper_id
     FROM questions q
     WHERE ${where}
     ORDER BY q.created_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, limit, (page - 1) * limit) as QuestionRow[];

  return { questions, total: totalRow.cnt };
}

export function updateUserQuestion(
  id: number,
  userId: number,
  fields: Record<string, unknown>,
): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const allowed = ["question_text", "answer", "explanation", "difficulty",
    "question_type", "options", "status", "knowledge_point_id", "exam_paper_id"];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return false;
  vals.push(id, userId);
  const result = db.prepare(
    `UPDATE questions SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  ).run(...vals);
  return result.changes > 0;
}

export function deleteUserQuestion(id: number, userId: number): boolean {
  const result = db.prepare(
    "DELETE FROM questions WHERE id = ? AND user_id = ?",
  ).run(id, userId);
  return result.changes > 0;
}

export function bulkImportUserQuestions(
  userId: number,
  items: {
    question_text: string;
    answer: string;
    question_type?: string;
    explanation?: string;
    difficulty?: number;
    options?: string;
    knowledge_point_id?: number;
    exam_paper_id?: number;
  }[],
): { imported: number } {
  const stmt = db.prepare(
    `INSERT INTO questions (user_id, exam_paper_id, knowledge_point_id, question_text, answer,
       explanation, difficulty, question_type, options, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction(() => {
    let count = 0;
    for (const q of items) {
      stmt.run(userId, q.exam_paper_id || null, q.knowledge_point_id || null,
        q.question_text, q.answer, q.explanation || null,
        q.difficulty || 1, q.question_type || "short_answer",
        q.options || null, now);
      count++;
    }
    return count;
  });
  return { imported: insertMany() };
}

// Admin: paginated questions with filters
export function getQuestionsAdmin(opts?: {
  subjectId?: number; kpId?: number; status?: string; page?: number; limit?: number;
}): { questions: QuestionRow[]; total: number } {
  const page = Math.max(1, opts?.page || 1);
  const limit = Math.min(100, Math.max(1, opts?.limit || 20));
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.subjectId) {
    conditions.push(`(q.knowledge_point_id IN (SELECT id FROM knowledge_points WHERE subject_id = ?) OR q.exam_paper_id IN (SELECT id FROM exam_papers WHERE subject_id = ?))`);
    params.push(opts.subjectId, opts.subjectId);
  }
  if (opts?.kpId) {
    conditions.push("q.knowledge_point_id = ?");
    params.push(opts.kpId);
  }
  if (opts?.status) {
    conditions.push("q.status = ?");
    params.push(opts.status);
  }
  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const totalRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM questions q ${where}`,
  ).get(...params) as { cnt: number };

  const questions = db.prepare(
    `SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type,
            q.options, q.knowledge_point_id, q.status, q.exam_paper_id, q.user_id
     FROM questions q ${where}
     ORDER BY q.created_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, limit, (page - 1) * limit) as QuestionRow[];

  return { questions, total: totalRow.cnt };
}

export function toggleQuestionStatus(id: number): string | null {
  const row = db.prepare("SELECT status FROM questions WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row) return null;
  const next = row.status === "published" ? "draft" : "published";
  db.prepare("UPDATE questions SET status = ? WHERE id = ?").run(next, id);
  return next;
}

export function findDuplicateQuestions(text: string): { id: number; question_text: string }[] {
  // Simple similarity: find questions whose text shares at least 60% common words
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return [];
  const likePattern = words.slice(0, 3).map(w => `%${w}%`).join(" OR question_text LIKE ");
  return db.prepare(
    `SELECT id, question_text FROM questions WHERE question_text LIKE ${likePattern} LIMIT 10`,
  ).all(...words.slice(0, 3).map(w => `%${w}%`)) as { id: number; question_text: string }[];
}

export function bulkImportQuestionsAdmin(
  items: {
    question_text: string; answer: string; question_type?: string;
    explanation?: string; difficulty?: number; options?: string;
    knowledge_point_id?: number; exam_paper_id?: number; status?: string; user_id?: number;
  }[],
): { imported: number } {
  const stmt = db.prepare(
    `INSERT INTO questions (user_id, exam_paper_id, knowledge_point_id, question_text, answer,
       explanation, difficulty, question_type, options, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction(() => {
    let count = 0;
    for (const q of items) {
      stmt.run(q.user_id || null, q.exam_paper_id || null, q.knowledge_point_id || null,
        q.question_text, q.answer, q.explanation || null,
        q.difficulty || 1, q.question_type || "short_answer",
        q.options || null, q.status || "draft", now);
      count++;
    }
    return count;
  });
  return { imported: insertMany() };
}

export function getUserProfile(userId: number): {
  total_answers: number; correct_answers: number; accuracy: number;
  active_days: number; active_plans: number; total_quizzes: number;
  weak_kp_count: number; avg_mastery: number;
} {
  const answers = db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(is_correct), 0) as correct
     FROM quiz_answers qa JOIN quiz_sessions qs ON qa.quiz_session_id = qs.id
     WHERE qs.user_id = ?`,
  ).get(userId) as { total: number; correct: number };

  const activeDays = db.prepare(
    `SELECT COUNT(DISTINCT DATE(timestamp)) as cnt FROM messages WHERE user_id = ?`,
  ).get(userId) as { cnt: number };

  const plans = db.prepare(
    "SELECT COUNT(*) as cnt FROM study_plans WHERE user_id = ?",
  ).get(userId) as { cnt: number };

  const quizzes = db.prepare(
    "SELECT COUNT(*) as cnt FROM quiz_sessions WHERE user_id = ?",
  ).get(userId) as { cnt: number };

  const weakKps = db.prepare(
    "SELECT COUNT(*) as cnt FROM user_kp_weakness WHERE user_id = ?",
  ).get(userId) as { cnt: number };

  const masteryRows = db.prepare(
    "SELECT mastery FROM user_kp_mastery WHERE user_id = ?",
  ).all(userId) as { mastery: number }[];

  const avg = masteryRows.length > 0
    ? masteryRows.reduce((s, r) => s + r.mastery, 0) / masteryRows.length : 0;

  return {
    total_answers: answers.total,
    correct_answers: answers.correct,
    accuracy: answers.total > 0 ? Math.round((answers.correct / answers.total) * 100) : 0,
    active_days: activeDays.cnt,
    active_plans: plans.cnt,
    total_quizzes: quizzes.cnt,
    weak_kp_count: weakKps.cnt,
    avg_mastery: Math.round(avg * 1000) / 1000,
  };
}

export function deleteUserCascade(userId: number): void {
  const del = db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM quiz_answers WHERE quiz_session_id IN (SELECT id FROM quiz_sessions WHERE user_id = ?)").run(userId);
    db.prepare("DELETE FROM quiz_sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM wrong_questions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM study_plans WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM scheduled_tasks WHERE user_id = ?").run(String(userId));
    db.prepare("DELETE FROM session_context WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_kp_mastery WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_kp_weakness WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM questions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  del();
}

// ============== Quiz session queries ==============

export function createQuizSession(subjectId: number, userId: number): number {
  const result = db.prepare(
    "INSERT INTO quiz_sessions (subject_id, user_id, started_at) VALUES (?, ?, ?)",
  ).run(subjectId, userId, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function recordQuizAnswer(
  sessionId: number, subjectId: number, questionId: number,
  studentAnswer: string, isCorrect: boolean,
  weakKpIds?: number[],
): void {
  db.prepare(
    `INSERT INTO quiz_answers (quiz_session_id, subject_id, question_id, student_answer, is_correct, weak_kp_ids, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, subjectId, questionId, studentAnswer, isCorrect ? 1 : 0,
    weakKpIds?.length ? JSON.stringify(weakKpIds) : null,
    new Date().toISOString());
}

export function updateQuizAnswerWeakKps(
  sessionId: number,
  questionId: number,
  kpIds: number[],
): void {
  db.prepare(
    `UPDATE quiz_answers SET weak_kp_ids = ? WHERE quiz_session_id = ? AND question_id = ?`,
  ).run(JSON.stringify(kpIds), sessionId, questionId);
}

export function finishQuizSession(sessionId: number): { total: number; correct: number } {
  const stats = db.prepare(
    "SELECT COUNT(*) as total, COALESCE(SUM(is_correct), 0) as correct FROM quiz_answers WHERE quiz_session_id = ?",
  ).get(sessionId) as { total: number; correct: number };
  db.prepare(
    "UPDATE quiz_sessions SET finished_at = ?, total_questions = ?, correct_count = ? WHERE id = ?",
  ).run(new Date().toISOString(), stats.total, stats.correct, sessionId);
  return stats;
}

export function getActiveQuizSession(userId: number): {
  id: number; subject_id: number; started_at: string;
} | undefined {
  return db.prepare(
    `SELECT id, subject_id, started_at FROM quiz_sessions
     WHERE user_id = ? AND finished_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).get(userId) as { id: number; subject_id: number; started_at: string } | undefined;
}

export function getQuizSessionAnswers(sessionId: number): {
  question_id: number; student_answer: string; is_correct: number;
}[] {
  return db.prepare(
    "SELECT question_id, student_answer, is_correct FROM quiz_answers WHERE quiz_session_id = ?",
  ).all(sessionId) as { question_id: number; student_answer: string; is_correct: number }[];
}

// ============== Wrong question / Spaced repetition ==============

export function recordWrongQuestion(questionId: number, userId: number, subjectId: number): void {
  const existing = db.prepare(
    "SELECT id, wrong_count FROM wrong_questions WHERE question_id = ? AND user_id = ?",
  ).get(questionId, userId) as { id: number; wrong_count: number } | undefined;

  const now = new Date();
  const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (existing) {
    db.prepare(
      `UPDATE wrong_questions
       SET wrong_count = ?, subject_id = ?, consecutive_correct = 0, last_reviewed_at = ?,
           next_review_at = ?, review_interval_days = 1, mastered = 0
       WHERE id = ?`,
    ).run(existing.wrong_count + 1, subjectId, now.toISOString(), nextReview.toISOString(), existing.id);
  } else {
    db.prepare(
      `INSERT INTO wrong_questions (question_id, user_id, wrong_count, consecutive_correct,
         last_reviewed_at, next_review_at, review_interval_days, mastered)
       VALUES (?, ?, 1, 0, ?, ?, 1, 0)`,
    ).run(questionId, userId, now.toISOString(), nextReview.toISOString());
  }
}

export interface WrongQuestionRow {
  id: number;
  question_id: number;
  question_text: string;
  answer: string;
  explanation: string | null;
  question_type: string;
  options: string | null;
  wrong_count: number;
  consecutive_correct: number;
  last_reviewed_at: string;
  next_review_at: string;
  review_interval_days: number;
  mastered: number;
}

export function getDueReviews(userId: number, subjectId?: number): WrongQuestionRow[] {
  const now = new Date().toISOString();
  let query = `
    SELECT wq.id, wq.question_id, q.question_text, q.answer, q.explanation,
           q.question_type, q.options, wq.wrong_count, wq.consecutive_correct,
           wq.last_reviewed_at, wq.next_review_at, wq.review_interval_days, wq.mastered
    FROM wrong_questions wq
    JOIN questions q ON wq.question_id = q.id
    WHERE wq.user_id = ? AND wq.next_review_at <= ? AND wq.mastered = 0`;
  if (subjectId) {
    query += ` AND (q.knowledge_point_id IN (SELECT id FROM knowledge_points WHERE subject_id = ?)
                 OR q.exam_paper_id IN (SELECT id FROM exam_papers WHERE subject_id = ?))`;
    return db.prepare(query + " ORDER BY wq.next_review_at ASC LIMIT 20").all(
      userId, now, subjectId, subjectId,
    ) as WrongQuestionRow[];
  }
  return db.prepare(query + " ORDER BY wq.next_review_at ASC LIMIT 20").all(
    userId, now,
  ) as WrongQuestionRow[];
}

export function updateReviewResult(wrongQuestionId: number, isCorrect: boolean): {
  consecutive_correct: number; mastered: boolean; next_review_at: string;
} {
  const row = db.prepare(
    "SELECT consecutive_correct, review_interval_days FROM wrong_questions WHERE id = ?",
  ).get(wrongQuestionId) as { consecutive_correct: number; review_interval_days: number };

  const now = new Date();

  if (isCorrect) {
    const newConsecutive = row.consecutive_correct + 1;
    const intervals = [1, 3, 7, 14, 30];
    const idx = Math.min(newConsecutive - 1, intervals.length - 1);
    const newInterval = intervals[idx];
    const mastered = newConsecutive >= 3 ? 1 : 0;
    const nextReview = new Date(now.getTime() + newInterval * 24 * 60 * 60 * 1000);

    db.prepare(
      `UPDATE wrong_questions
       SET consecutive_correct = ?, last_reviewed_at = ?, next_review_at = ?,
           review_interval_days = ?, mastered = ?
       WHERE id = ?`,
    ).run(newConsecutive, now.toISOString(), nextReview.toISOString(), newInterval, mastered, wrongQuestionId);

    return { consecutive_correct: newConsecutive, mastered: mastered === 1, next_review_at: nextReview.toISOString() };
  }

  const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  db.prepare(
    `UPDATE wrong_questions
     SET consecutive_correct = 0, last_reviewed_at = ?, next_review_at = ?,
         review_interval_days = 1, mastered = 0
     WHERE id = ?`,
  ).run(now.toISOString(), nextReview.toISOString(), wrongQuestionId);

  return { consecutive_correct: 0, mastered: false, next_review_at: nextReview.toISOString() };
}

export function getWrongQuestionsBySubject(
  userId: number, subjectId?: number,
): { question_text: string; answer: string; wrong_count: number; mastered: number; subject_name: string }[] {
  if (subjectId) {
    return db.prepare(
      `SELECT q.question_text, q.answer, wq.wrong_count, wq.mastered, s.name as subject_name
       FROM wrong_questions wq
       JOIN questions q ON wq.question_id = q.id
       LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
       LEFT JOIN exam_papers ep ON q.exam_paper_id = ep.id
       LEFT JOIN subjects s ON (kp.subject_id = s.id OR ep.subject_id = s.id)
       WHERE wq.user_id = ? AND s.id = ?
       ORDER BY wq.wrong_count DESC`,
    ).all(userId, subjectId) as {
      question_text: string; answer: string; wrong_count: number; mastered: number; subject_name: string;
    }[];
  }
  return db.prepare(
    `SELECT q.question_text, q.answer, wq.wrong_count, wq.mastered, COALESCE(s.name, 'Unknown') as subject_name
     FROM wrong_questions wq
     JOIN questions q ON wq.question_id = q.id
     LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
     LEFT JOIN exam_papers ep ON q.exam_paper_id = ep.id
     LEFT JOIN subjects s ON (kp.subject_id = s.id OR ep.subject_id = s.id)
     WHERE wq.user_id = ?
     ORDER BY wq.mastered ASC, wq.wrong_count DESC`,
  ).all(userId) as {
    question_text: string; answer: string; wrong_count: number; mastered: number; subject_name: string;
  }[];
}

export function getStudyStats(userId: number, subjectId?: number): {
  total_quizzes: number; total_answers: number; correct_answers: number;
  active_wrong_questions: number; mastered_questions: number; due_reviews: number;
} {
  const now = new Date().toISOString();

  const quizCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM quiz_sessions WHERE user_id = ?" +
    (subjectId ? " AND subject_id = ?" : ""),
  ).get(userId, ...(subjectId ? [subjectId] : [])) as { cnt: number };

  const answerStats = db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(is_correct), 0) as correct
     FROM quiz_answers qa
     JOIN quiz_sessions qs ON qa.quiz_session_id = qs.id
     WHERE qs.user_id = ?` +
    (subjectId ? " AND qs.subject_id = ?" : ""),
  ).get(userId, ...(subjectId ? [subjectId] : [])) as { total: number; correct: number };

  const wqParams: (number | string)[] = [userId];
  if (subjectId) {
    wqParams.push(subjectId, subjectId);
  }
  const wqStats = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN wq.mastered = 0 THEN 1 ELSE 0 END), 0) as active,
       COALESCE(SUM(CASE WHEN wq.mastered = 1 THEN 1 ELSE 0 END), 0) as mastered,
       COALESCE(SUM(CASE WHEN wq.next_review_at <= ? AND wq.mastered = 0 THEN 1 ELSE 0 END), 0) as due
     FROM wrong_questions wq
     JOIN questions q ON wq.question_id = q.id
     WHERE wq.user_id = ?` +
    (subjectId
      ? ` AND (q.knowledge_point_id IN (SELECT id FROM knowledge_points WHERE subject_id = ?)
            OR q.exam_paper_id IN (SELECT id FROM exam_papers WHERE subject_id = ?))`
      : ""),
  ).get(now, ...wqParams) as { active: number; mastered: number; due: number };

  return {
    total_quizzes: quizCount.cnt, total_answers: answerStats.total,
    correct_answers: answerStats.correct,
    active_wrong_questions: wqStats.active, mastered_questions: wqStats.mastered,
    due_reviews: wqStats.due,
  };
}

// ============== Study plan queries ==============

export interface StudyPlanRow {
  id: number; user_id: number; subject_id: number | null;
  title: string; plan_data: string;
  start_date: string; end_date: string; created_at: string;
}

export interface PlanTask {
  day: number; date: string; topic: string; task: string; completed: boolean;
}

export function createStudyPlan(
  userId: number, title: string, planData: PlanTask[],
  startDate: string, endDate: string, subjectId?: number,
): number {
  const result = db.prepare(
    `INSERT INTO study_plans (user_id, subject_id, title, plan_data, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, subjectId || null, title, JSON.stringify(planData), startDate, endDate, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function getStudyPlan(planId: number): (StudyPlanRow & { tasks: PlanTask[] }) | undefined {
  const row = db.prepare(
    "SELECT id, user_id, subject_id, title, plan_data, start_date, end_date, created_at FROM study_plans WHERE id = ?",
  ).get(planId) as StudyPlanRow | undefined;
  if (!row) return undefined;
  const tasks = JSON.parse(row.plan_data) as PlanTask[];
  return { ...row, tasks };
}

export function getActiveStudyPlan(userId: number): (StudyPlanRow & { tasks: PlanTask[] }) | undefined {
  const row = db.prepare(
    `SELECT id, user_id, subject_id, title, plan_data, start_date, end_date, created_at
     FROM study_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(userId) as StudyPlanRow | undefined;
  if (!row) return undefined;
  const tasks = JSON.parse(row.plan_data) as PlanTask[];
  return { ...row, tasks };
}

export function markPlanTaskDone(planId: number, dayIndex: number): PlanTask[] | null {
  const plan = getStudyPlan(planId);
  if (!plan) return null;
  if (dayIndex < 0 || dayIndex >= plan.tasks.length) return null;
  plan.tasks[dayIndex].completed = true;
  db.prepare("UPDATE study_plans SET plan_data = ? WHERE id = ?").run(JSON.stringify(plan.tasks), planId);
  return plan.tasks;
}

export function getStudyPlanProgress(planId: number): {
  total: number; completed: number; percent: number; upcoming: PlanTask[];
} | null {
  const plan = getStudyPlan(planId);
  if (!plan) return null;
  const total = plan.tasks.length;
  const completed = plan.tasks.filter((t) => t.completed).length;
  const upcoming = plan.tasks.filter((t) => !t.completed).slice(0, 5);
  return { total, completed, percent: total > 0 ? Math.round((completed / total) * 100) : 0, upcoming };
}

export function getStudyPlansByUser(userId: number): StudyPlanRow[] {
  return db.prepare(
    `SELECT id, user_id, subject_id, title, plan_data, start_date, end_date, created_at
     FROM study_plans WHERE user_id = ? ORDER BY created_at DESC`,
  ).all(userId) as StudyPlanRow[];
}

// ============== Session context queries ==============

export interface SessionContext {
  user_id: number; topic: string | null;
  weak_areas: string | null; summary: string | null; updated_at: string;
}

export function getRecentMessages(
  userId: number, limit: number, excludeBot?: boolean,
): NewMessage[] {
  let query = `
    SELECT id, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages WHERE user_id = ?
  `;
  if (excludeBot) query += " AND is_bot_message = 0";
  query += " ORDER BY timestamp DESC LIMIT ?";
  return db.prepare(query).all(userId, limit).reverse() as NewMessage[];
}

export function getSessionContext(userId: number): SessionContext | undefined {
  return db.prepare(
    "SELECT user_id, topic, weak_areas, summary, updated_at FROM session_context WHERE user_id = ?",
  ).get(userId) as SessionContext | undefined;
}

export function upsertSessionContext(
  userId: number, topic?: string | null,
  weakAreas?: string | null, summary?: string | null,
): void {
  const existing = getSessionContext(userId);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE session_context
       SET topic = COALESCE(?, topic), weak_areas = COALESCE(?, weak_areas),
           summary = COALESCE(?, summary), updated_at = ?
       WHERE user_id = ?`,
    ).run(topic ?? existing.topic, weakAreas ?? existing.weak_areas,
      summary ?? existing.summary, now, userId);
  } else {
    db.prepare(
      "INSERT INTO session_context (user_id, topic, weak_areas, summary, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, topic || null, weakAreas || null, summary || null, now);
  }
}

export function getWeakAreas(userId: number): string[] {
  const rows = db.prepare(
    `SELECT s.name as subject, COUNT(*) as cnt
     FROM wrong_questions wq
     JOIN questions q ON wq.question_id = q.id
     LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
     LEFT JOIN subjects s ON kp.subject_id = s.id
     WHERE wq.user_id = ? AND wq.mastered = 0
     GROUP BY s.name ORDER BY cnt DESC LIMIT 5`,
  ).all(userId) as { subject: string; cnt: number }[];

  return rows.map((r) => `${r.subject} (${r.cnt} wrong)`);
}

// ============== Knowledge point mastery ==============

const KP_MASTERY_ALPHA = 0.2;

export function updateKpMastery(
  userId: number,
  subjectId: number,
  kpId: number,
  correct: boolean,
): { mastery: number; previous: number } {
  const existing = db.prepare(
    "SELECT mastery FROM user_kp_mastery WHERE user_id = ? AND subject_id = ? AND kp_id = ?",
  ).get(userId, subjectId, kpId) as { mastery: number } | undefined;

  const previous = existing?.mastery ?? 0.5;
  const target = correct ? 1 : 0;
  const mastery = previous + KP_MASTERY_ALPHA * (target - previous);

  db.prepare(
    `INSERT INTO user_kp_mastery (user_id, subject_id, kp_id, mastery, last_updated)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, subject_id, kp_id) DO UPDATE SET mastery = excluded.mastery, last_updated = excluded.last_updated`,
  ).run(userId, subjectId, kpId, mastery, new Date().toISOString());

  return { mastery: Math.round(mastery * 1000) / 1000, previous };
}

export function setWrongQuestionRootKp(
  questionId: number,
  userId: number,
  kpId: number,
): void {
  db.prepare(
    `UPDATE wrong_questions SET root_kp_id = COALESCE(root_kp_id, ?)
     WHERE question_id = ? AND user_id = ?`,
  ).run(kpId, questionId, userId);
}

export function upsertKpWeakness(
  userId: number,
  subjectId: number,
  kpId: number,
  questionId: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_kp_weakness (user_id, subject_id, kp_id, total_wrong, representative_question_id, last_wrong_time)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, subject_id, kp_id) DO UPDATE SET
       total_wrong = total_wrong + 1,
       representative_question_id = COALESCE(user_kp_weakness.representative_question_id, excluded.representative_question_id),
       last_wrong_time = excluded.last_wrong_time`,
  ).run(userId, kpId, questionId, now);
}

export function clearKpWeaknessIfMastered(userId: number, subjectId: number, kpId: number): boolean {
  const row = db.prepare(
    "SELECT mastery FROM user_kp_mastery WHERE user_id = ? AND subject_id = ? AND kp_id = ?",
  ).get(userId, subjectId, kpId) as { mastery: number } | undefined;
  if (row && row.mastery > 0.8) {
    db.prepare("DELETE FROM user_kp_weakness WHERE user_id = ? AND subject_id = ? AND kp_id = ?").run(userId, subjectId, kpId);
    return true;
  }
  return false;
}

export interface UserKpMasteryRow {
  kp_id: number;
  mastery: number;
  total_wrong: number;
}

export function getUserKpMastery(userId: number): UserKpMasteryRow[] {
  return db.prepare(
    `SELECT ukm.kp_id, ukm.mastery,
            COALESCE(ukw.total_wrong, 0) as total_wrong
     FROM user_kp_mastery ukm
     LEFT JOIN user_kp_weakness ukw ON ukw.user_id = ukm.user_id AND ukw.kp_id = ukm.kp_id
     WHERE ukm.user_id = ?
     ORDER BY ukm.mastery ASC`,
  ).all(userId) as UserKpMasteryRow[];
}

export interface WeakKpRow {
  kp_id: number;
  kp_name: string;
  mastery: number;
  total_wrong: number;
}

export function getWeakKpsForUser(userId: number): WeakKpRow[] {
  return db.prepare(
    `SELECT ukw.kp_id, kp.title as kp_name,
            COALESCE(ukm.mastery, 0.5) as mastery,
            ukw.total_wrong
     FROM user_kp_weakness ukw
     LEFT JOIN user_kp_mastery ukm ON ukm.user_id = ukw.user_id AND ukm.kp_id = ukw.kp_id
     JOIN knowledge_points kp ON kp.id = ukw.kp_id
     WHERE ukw.user_id = ?
     ORDER BY ukm.mastery ASC NULLS FIRST
     LIMIT 20`,
  ).all(userId) as WeakKpRow[];
}

export function getKpMasteryStats(userId: number): {
  avg_mastery: number;
  kp_count: number;
  weakness_total: number;
  weakness_cleared: number;
} {
  const masteryRows = db.prepare(
    "SELECT mastery FROM user_kp_mastery WHERE user_id = ?",
  ).all(userId) as { mastery: number }[];

  const avg = masteryRows.length > 0
    ? masteryRows.reduce((s, r) => s + r.mastery, 0) / masteryRows.length
    : 0;

  const weaknessTotal = (db.prepare(
    "SELECT COUNT(*) as cnt FROM user_kp_weakness WHERE user_id = ?",
  ).get(userId) as { cnt: number }).cnt;

  // Cleared = KPs with mastery > 0.8 that are NOT in weakness table anymore
  const masteredCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM user_kp_mastery WHERE user_id = ? AND mastery > 0.8",
  ).get(userId) as { cnt: number }).cnt;

  return {
    avg_mastery: Math.round(avg * 1000) / 1000,
    kp_count: masteryRows.length,
    weakness_total: weaknessTotal,
    weakness_cleared: Math.max(0, masteredCount - weaknessTotal),
  };
}

// ============== Scheduled task queries ==============

export interface ScheduledTaskRow {
  id: string; user_id: number;
  prompt: string; schedule_type: string; schedule_value: string;
  next_run: string | null; last_run: string | null;
  last_result: string | null; status: string; created_at: string;
}

function computeNextRun(type: string, value: string): string {
  const now = new Date();
  if (type === "daily") {
    const [h, m] = value.split(":").map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  if (type === "once") return value;
  if (type === "interval") {
    const minutes = parseInt(value, 10) || 60;
    return new Date(now.getTime() + minutes * 60000).toISOString();
  }
  return new Date(now.getTime() + 86400000).toISOString();
}

export function getDueScheduledTasks(userId: number): ScheduledTaskRow[] {
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT id, user_id, prompt, schedule_type, schedule_value,
            next_run, last_run, last_result, status, created_at
     FROM scheduled_tasks
     WHERE user_id = ? AND next_run <= ? AND status = 'active'
     ORDER BY next_run ASC`,
  ).all(userId, now) as ScheduledTaskRow[];
}

export function getAllDueScheduledTasks(): ScheduledTaskRow[] {
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT id, user_id, prompt, schedule_type, schedule_value,
            next_run, last_run, last_result, status, created_at
     FROM scheduled_tasks
     WHERE next_run <= ? AND status = 'active'
     ORDER BY next_run ASC`,
  ).all(now) as ScheduledTaskRow[];
}

export function createScheduledTask(
  userId: number, prompt: string,
  scheduleType: string, scheduleValue: string,
): string {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextRun = computeNextRun(scheduleType, scheduleValue);
  db.prepare(
    `INSERT INTO scheduled_tasks (id, user_id, prompt, schedule_type, schedule_value, next_run, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, userId, prompt, scheduleType, scheduleValue, nextRun, new Date().toISOString());
  return id;
}

export function updateScheduledTaskRun(id: string, nextRun: string, lastResult?: string): void {
  db.prepare(
    "UPDATE scheduled_tasks SET last_run = ?, next_run = ?, last_result = ? WHERE id = ?",
  ).run(new Date().toISOString(), nextRun, lastResult || null, id);
}

export function cancelScheduledTask(id: string): boolean {
  const result = db.prepare("UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getScheduledTasksByUser(userId: number): ScheduledTaskRow[] {
  return db.prepare(
    `SELECT id, user_id, prompt, schedule_type, schedule_value,
            next_run, last_run, last_result, status, created_at
     FROM scheduled_tasks WHERE user_id = ? AND status = 'active'
     ORDER BY next_run ASC`,
  ).all(userId) as ScheduledTaskRow[];
}
