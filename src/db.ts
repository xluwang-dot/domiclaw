/**
 * Domiclaw 数据库模块
 *
 * 使用 SQLite 存储所有数据:
 * - 聊天记录
 * - 消息历史
 * - 群组配置
 * - 路由状态
 *
 * 表格:
 * - chats: 聊天/群组元数据
 * - messages: 消息历史
 * - registered_groups: 已注册的群组
 * - router_state: 路由状态（如游标）
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { STORE_DIR } from "./config.js";
import { logger } from "./logger.js";
import { NewMessage, RegisteredGroup } from "./types.js";

/**
 * SQLite 数据库实例
 */
let db: Database.Database;

/**
 * 创建数据库表格
 *
 * @param database 数据库实例
 */
function createSchema(database: Database.Database): void {
  // 创建所有必要的表格
  database.exec(`
    -- 聊天/群组元数据表
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,           -- 聊天 ID（唯一标识）
      name TEXT,                 -- 聊天名称
      last_message_time TEXT,     -- 最后消息时间
      channel TEXT,             -- 频道类型（tui/qq/telegram）
      is_group INTEGER DEFAULT 0  -- 是否为群组
    );

    -- 消息历史表
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,                    -- 消息 ID
      chat_jid TEXT,            -- 聊天 ID（外键）
      sender TEXT,             -- 发送者 ID
      sender_name TEXT,         -- 发送者名称
      content TEXT,            -- 消息内容
      timestamp TEXT,          -- 时间戳
      is_from_me INTEGER,       -- 是否为机器人发送
      is_bot_message INTEGER DEFAULT 0,  -- 是否为机器人回复
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    -- 消息时间戳索引（加速查询）
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    -- 已注册的群组表
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,          -- 聊天 ID
      name TEXT NOT NULL,            -- 群组名称
      folder TEXT NOT NULL UNIQUE,    -- 群组文件夹（唯一）
      trigger_pattern TEXT NOT NULL,  -- 触发词
      added_at TEXT NOT NULL,         -- 添加时间
      container_config TEXT,         -- 容器配置（预留）
      requires_trigger INTEGER DEFAULT 1,  -- 是否需要触发词
      is_main INTEGER DEFAULT 0       -- 是否为主群
    );

    -- 路由状态表（存储游标等）
    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,    -- 状态键
      value TEXT NOT NULL  -- 状态值
    );

    -- 学科表
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL
    );

    -- 知识点表
    CREATE TABLE IF NOT EXISTS knowledge_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );

    -- 试卷表
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

    -- 题目表
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_paper_id INTEGER,
      knowledge_point_id INTEGER,
      question_text TEXT NOT NULL,
      answer TEXT NOT NULL,
      explanation TEXT,
      difficulty INTEGER DEFAULT 1,
      question_type TEXT NOT NULL DEFAULT 'short_answer',
      options TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (exam_paper_id) REFERENCES exam_papers(id),
      FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
    );

    -- 测验会话表
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      chat_jid TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      total_questions INTEGER DEFAULT 0,
      correct_count INTEGER DEFAULT 0,
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );

    -- 测验作答记录表
    CREATE TABLE IF NOT EXISTS quiz_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_session_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      student_answer TEXT,
      is_correct INTEGER DEFAULT 0,
      answered_at TEXT NOT NULL,
      FOREIGN KEY (quiz_session_id) REFERENCES quiz_sessions(id),
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );

    -- 错题追踪表（间隔重复状态）
    CREATE TABLE IF NOT EXISTS wrong_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      chat_jid TEXT NOT NULL,
      wrong_count INTEGER DEFAULT 1,
      consecutive_correct INTEGER DEFAULT 0,
      last_reviewed_at TEXT NOT NULL,
      next_review_at TEXT NOT NULL,
      review_interval_days INTEGER DEFAULT 1,
      mastered INTEGER DEFAULT 0,
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wq_next_review ON wrong_questions(next_review_at);
    CREATE INDEX IF NOT EXISTS idx_wq_chat_jid ON wrong_questions(chat_jid);

    -- 学习计划表
    CREATE TABLE IF NOT EXISTS study_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      subject_id INTEGER,
      title TEXT NOT NULL,
      plan_data TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sp_chat_jid ON study_plans(chat_jid);

    -- 定时任务表
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_st_chat_jid ON scheduled_tasks(chat_jid);

    -- 会话上下文表
    CREATE TABLE IF NOT EXISTS session_context (
      chat_jid TEXT PRIMARY KEY,
      topic TEXT,
      weak_areas TEXT,
      summary TEXT,
      updated_at TEXT NOT NULL
    );
  `);

    // Seed common subjects on first run
    const count = database.prepare(
      "SELECT COUNT(*) as cnt FROM subjects",
    ).get() as { cnt: number };
    if (count.cnt === 0) {
      const now = new Date().toISOString();
      const subjects = [
        "Mathematics",
        "Physics",
        "Chemistry",
        "Biology",
        "English",
        "Chinese",
        "History",
        "Geography",
        "Politics",
      ];
      const insert = database.prepare(
        "INSERT INTO subjects (name, description, created_at) VALUES (?, ?, ?)",
      );
      for (const name of subjects) {
        insert.run(name, null, now);
      }
    }
}

/**
 * 初始化数据库
 *
 * 首次运行时创建数据库文件和表格
 */
export function initDatabase(): void {
  // 构建数据库路径
  const dbPath = path.join(STORE_DIR, "messages.db");

  // 确保目录存在
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // 打开/创建数据库
  db = new Database(dbPath);

  // 创建表格
  createSchema(db);
}

/**
 * 存储消息到数据库
 *
 * @param msg 消息对象
 */
export function storeMessage(msg: NewMessage): void {
  // Ensure chat row exists first (FK constraint on messages.chat_jid)
  db.prepare(
    `
    INSERT OR REPLACE INTO chats (jid, last_message_time)
    VALUES (?, ?)
  `,
  ).run(msg.chat_jid, msg.timestamp);

  db.prepare(
    `
    INSERT OR REPLACE INTO messages
    (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

/**
 * 存储聊天元数据
 *
 * @param chatJid 聊天 ID
 * @param timestamp 最后消息时间
 * @param name 聊天名称（可选）
 * @param channel 频道类型（可选）
 * @param isGroup 是否为群组（可选）
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  // 解析频道和群组标志
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;

  if (name) {
    // 更新名称，保留较新的时间戳
    db.prepare(
      `
      UPDATE chats 
      SET name = ?, last_message_time = COALESCE(
        (SELECT last_message_time FROM chats WHERE jid = ?), ?
      )
      WHERE jid = ? OR jid IS NULL
    `,
    ).run(name, chatJid, timestamp, chatJid);
  }
}

/**
 * 获取所有聊天列表
 *
 * @returns 聊天数组
 */
export function getAllChats(): { jid: string; name?: string }[] {
  return db.prepare("SELECT jid, name FROM chats").all() as {
    jid: string;
    name?: string;
  }[];
}

/**
 * 获取指定时间之后的消息
 *
 * @param chatJid 聊天 ID
 * @param afterTimestamp 起始时间戳（空字符串表示从头开始）
 * @param assistantName AI 助手名称（用于过滤自己的消息）
 * @param limit 最大返回数量
 * @returns 消息数组
 */
export function getMessagesSince(
  chatJid: string,
  afterTimestamp: string,
  assistantName: string,
  limit: number,
): NewMessage[] {
  // 构建查询
  let query = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
  `;

  const params: (string | number)[] = [chatJid, afterTimestamp];

  // 过滤参数
  query += ` ORDER BY timestamp ASC LIMIT ?`;
  params.push(limit);

  return db.prepare(query).all(...params) as NewMessage[];
}

/**
 * 获取所有已注册的群组
 *
 * @returns 群组映射（jid -> RegisteredGroup）
 */
export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db
    .prepare(
      `
    SELECT jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main
    FROM registered_groups
  `,
    )
    .all() as {
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    requires_trigger: number;
    is_main: number;
  }[];

  // 转换为映射
  const groups: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    groups[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      requiresTrigger: row.requires_trigger === 1,
      isMain: row.is_main === 1,
    };
  }
  return groups;
}

/**
 * 设置群组注册信息
 *
 * @param jid 聊天 ID
 * @param group 群组配置
 */
export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO registered_groups 
    (jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.requiresTrigger !== false ? 1 : 0,
    group.isMain ? 1 : 0,
  );
}

/**
 * 获取路由状态
 *
 * @param key 状态键
 * @returns 状态值（不存在返回 undefined）
 */
export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM router_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

/**
 * 设置路由状态
 *
 * @param key 状态键
 * @param value 状态值
 */
export function setRouterState(key: string, value: string): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO router_state (key, value)
    VALUES (?, ?)
  `,
  ).run(key, value);
}

// ============== Subject queries ==============

export function getAllSubjects(): { id: number; name: string; description: string | null }[] {
  return db.prepare("SELECT id, name, description FROM subjects ORDER BY name").all() as {
    id: number;
    name: string;
    description: string | null;
  }[];
}

export function getSubjectByName(name: string): { id: number; name: string } | undefined {
  return db.prepare("SELECT id, name FROM subjects WHERE name = ?").get(name) as
    | { id: number; name: string }
    | undefined;
}

// ============== Knowledge point queries ==============

export function addKnowledgePoint(
  subjectId: number,
  title: string,
  content: string,
  tags?: string,
): number {
  const result = db.prepare(
    `INSERT INTO knowledge_points (subject_id, title, content, tags, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(subjectId, title, content, tags || null, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function searchKnowledgePoints(query: string, subjectId?: number): {
  id: number;
  subject_id: number;
  title: string;
  content: string;
  tags: string | null;
}[] {
  const like = `%${query}%`;
  if (subjectId) {
    return db.prepare(
      `SELECT id, subject_id, title, content, tags
       FROM knowledge_points
       WHERE (title LIKE ? OR content LIKE ? OR tags LIKE ?)
       AND subject_id = ?
       ORDER BY title LIMIT 20`,
    ).all(like, like, like, subjectId) as {
      id: number;
      subject_id: number;
      title: string;
      content: string;
      tags: string | null;
    }[];
  }
  return db.prepare(
    `SELECT id, subject_id, title, content, tags
     FROM knowledge_points
     WHERE title LIKE ? OR content LIKE ? OR tags LIKE ?
     ORDER BY title LIMIT 20`,
  ).all(like, like, like) as {
    id: number;
    subject_id: number;
    title: string;
    content: string;
    tags: string | null;
  }[];
}

export function getKnowledgePointById(id: number): {
  id: number;
  title: string;
  content: string;
  tags: string | null;
} | undefined {
  return db.prepare("SELECT id, title, content, tags FROM knowledge_points WHERE id = ?").get(id) as
    | { id: number; title: string; content: string; tags: string | null }
    | undefined;
}

export function getKnowledgePointsBySubject(subjectId: number): {
  id: number;
  title: string;
  content: string;
  tags: string | null;
}[] {
  return db.prepare(
    `SELECT id, title, content, tags FROM knowledge_points WHERE subject_id = ? ORDER BY title`,
  ).all(subjectId) as {
    id: number;
    title: string;
    content: string;
    tags: string | null;
  }[];
}

// ============== Exam paper queries ==============

export function addExamPaper(
  subjectId: number,
  title: string,
  examDate?: string,
  totalScore?: number,
  durationMinutes?: number,
): number {
  const result = db.prepare(
    `INSERT INTO exam_papers (subject_id, title, total_score, duration_minutes, exam_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(subjectId, title, totalScore || 100, durationMinutes || 60, examDate || null, new Date().toISOString());
  return result.lastInsertRowid as number;
}

// ============== Question queries ==============

export function addQuestion(
  examPaperId: number | null,
  knowledgePointId: number | null,
  questionText: string,
  answer: string,
  questionType: string,
  explanation?: string,
  difficulty?: number,
  options?: string,
): number {
  const result = db.prepare(
    `INSERT INTO questions (exam_paper_id, knowledge_point_id, question_text, answer, explanation, difficulty, question_type, options, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    examPaperId,
    knowledgePointId,
    questionText,
    answer,
    explanation || null,
    difficulty || 1,
    questionType,
    options || null,
    new Date().toISOString(),
  );
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
}

export function getQuestionsBySubject(subjectId: number, limit = 50): QuestionRow[] {
  return db.prepare(
    `SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type, q.options, q.knowledge_point_id
     FROM questions q
     LEFT JOIN exam_papers ep ON q.exam_paper_id = ep.id
     LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
     WHERE ep.subject_id = ? OR kp.subject_id = ?
     ORDER BY RANDOM() LIMIT ?`,
  ).all(subjectId, subjectId, limit) as QuestionRow[];
}

export function getQuestionsByKnowledgePoint(knowledgePointId: number): QuestionRow[] {
  return db.prepare(
    `SELECT id, question_text, answer, explanation, difficulty, question_type, options, knowledge_point_id
     FROM questions WHERE knowledge_point_id = ?`,
  ).all(knowledgePointId) as QuestionRow[];
}

export function getQuestionById(id: number): QuestionRow | undefined {
  return db.prepare(
    `SELECT id, question_text, answer, explanation, difficulty, question_type, options, knowledge_point_id
     FROM questions WHERE id = ?`,
  ).get(id) as QuestionRow | undefined;
}

// ============== Quiz session queries ==============

export function createQuizSession(subjectId: number, chatJid: string): number {
  const result = db.prepare(
    `INSERT INTO quiz_sessions (subject_id, chat_jid, started_at) VALUES (?, ?, ?)`,
  ).run(subjectId, chatJid, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function recordQuizAnswer(
  sessionId: number,
  questionId: number,
  studentAnswer: string,
  isCorrect: boolean,
): void {
  db.prepare(
    `INSERT INTO quiz_answers (quiz_session_id, question_id, student_answer, is_correct, answered_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, questionId, studentAnswer, isCorrect ? 1 : 0, new Date().toISOString());
}

export function finishQuizSession(sessionId: number): { total: number; correct: number } {
  const stats = db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(is_correct), 0) as correct
     FROM quiz_answers WHERE quiz_session_id = ?`,
  ).get(sessionId) as { total: number; correct: number };
  db.prepare(
    `UPDATE quiz_sessions SET finished_at = ?, total_questions = ?, correct_count = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), stats.total, stats.correct, sessionId);
  return stats;
}

export function getActiveQuizSession(chatJid: string): {
  id: number;
  subject_id: number;
  started_at: string;
} | undefined {
  return db.prepare(
    `SELECT id, subject_id, started_at FROM quiz_sessions
     WHERE chat_jid = ? AND finished_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).get(chatJid) as { id: number; subject_id: number; started_at: string } | undefined;
}

export function getQuizSessionAnswers(sessionId: number): {
  question_id: number;
  student_answer: string;
  is_correct: number;
}[] {
  return db.prepare(
    `SELECT question_id, student_answer, is_correct FROM quiz_answers WHERE quiz_session_id = ?`,
  ).all(sessionId) as { question_id: number; student_answer: string; is_correct: number }[];
}

// ============== Wrong question / Spaced repetition queries ==============

export function recordWrongQuestion(questionId: number, chatJid: string): void {
  const existing = db.prepare(
    `SELECT id, wrong_count FROM wrong_questions WHERE question_id = ? AND chat_jid = ?`,
  ).get(questionId, chatJid) as { id: number; wrong_count: number } | undefined;

  const now = new Date();
  const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +1 day

  if (existing) {
    db.prepare(
      `UPDATE wrong_questions
       SET wrong_count = ?, consecutive_correct = 0, last_reviewed_at = ?,
           next_review_at = ?, review_interval_days = 1, mastered = 0
       WHERE id = ?`,
    ).run(existing.wrong_count + 1, now.toISOString(), nextReview.toISOString(), existing.id);
  } else {
    db.prepare(
      `INSERT INTO wrong_questions (question_id, chat_jid, wrong_count, consecutive_correct, last_reviewed_at, next_review_at, review_interval_days, mastered)
       VALUES (?, ?, 1, 0, ?, ?, 1, 0)`,
    ).run(questionId, chatJid, now.toISOString(), nextReview.toISOString());
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

export function getDueReviews(chatJid: string, subjectId?: number): WrongQuestionRow[] {
  const now = new Date().toISOString();
  let query = `
    SELECT wq.id, wq.question_id, q.question_text, q.answer, q.explanation,
           q.question_type, q.options, wq.wrong_count, wq.consecutive_correct,
           wq.last_reviewed_at, wq.next_review_at, wq.review_interval_days, wq.mastered
    FROM wrong_questions wq
    JOIN questions q ON wq.question_id = q.id
    WHERE wq.chat_jid = ? AND wq.next_review_at <= ? AND wq.mastered = 0`;
  if (subjectId) {
    query += ` AND (q.knowledge_point_id IN (SELECT id FROM knowledge_points WHERE subject_id = ?)
                 OR q.exam_paper_id IN (SELECT id FROM exam_papers WHERE subject_id = ?))`;
    return db.prepare(query + " ORDER BY wq.next_review_at ASC LIMIT 20").all(
      chatJid,
      now,
      subjectId,
      subjectId,
    ) as WrongQuestionRow[];
  }
  return db.prepare(query + " ORDER BY wq.next_review_at ASC LIMIT 20").all(
    chatJid,
    now,
  ) as WrongQuestionRow[];
}

export function updateReviewResult(wrongQuestionId: number, isCorrect: boolean): {
  consecutive_correct: number;
  mastered: boolean;
  next_review_at: string;
} {
  const row = db.prepare(
    `SELECT consecutive_correct, review_interval_days FROM wrong_questions WHERE id = ?`,
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

  // Wrong again — reset
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
  chatJid: string,
  subjectId?: number,
): { question_text: string; answer: string; wrong_count: number; mastered: number; subject_name: string }[] {
  if (subjectId) {
    return db.prepare(
      `SELECT q.question_text, q.answer, wq.wrong_count, wq.mastered, s.name as subject_name
       FROM wrong_questions wq
       JOIN questions q ON wq.question_id = q.id
       LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
       LEFT JOIN exam_papers ep ON q.exam_paper_id = ep.id
       LEFT JOIN subjects s ON (kp.subject_id = s.id OR ep.subject_id = s.id)
       WHERE wq.chat_jid = ? AND s.id = ?
       ORDER BY wq.wrong_count DESC`,
    ).all(chatJid, subjectId) as {
      question_text: string;
      answer: string;
      wrong_count: number;
      mastered: number;
      subject_name: string;
    }[];
  }
  return db.prepare(
    `SELECT q.question_text, q.answer, wq.wrong_count, wq.mastered, COALESCE(s.name, 'Unknown') as subject_name
     FROM wrong_questions wq
     JOIN questions q ON wq.question_id = q.id
     LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
     LEFT JOIN exam_papers ep ON q.exam_paper_id = ep.id
     LEFT JOIN subjects s ON (kp.subject_id = s.id OR ep.subject_id = s.id)
     WHERE wq.chat_jid = ?
     ORDER BY wq.mastered ASC, wq.wrong_count DESC`,
  ).all(chatJid) as {
    question_text: string;
    answer: string;
    wrong_count: number;
    mastered: number;
    subject_name: string;
  }[];
}

export function getStudyStats(chatJid: string, subjectId?: number): {
  total_quizzes: number;
  total_answers: number;
  correct_answers: number;
  active_wrong_questions: number;
  mastered_questions: number;
  due_reviews: number;
} {
  const now = new Date().toISOString();
  const subjectFilter = subjectId ? "AND subject_id = ?" : "";
  const wqSubjectFilter = subjectId
    ? `AND (q.knowledge_point_id IN (SELECT id FROM knowledge_points WHERE subject_id = ?)
         OR q.exam_paper_id IN (SELECT id FROM exam_papers WHERE subject_id = ?))`
    : "";

  const params: (string | number)[] = [chatJid];
  if (subjectId) params.push(subjectId);

  const quizCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM quiz_sessions WHERE chat_jid = ? ${subjectFilter}`,
  ).get(...params) as { cnt: number };

  params.length = 1;
  const answerStats = db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(is_correct), 0) as correct
     FROM quiz_answers qa
     JOIN quiz_sessions qs ON qa.quiz_session_id = qs.id
     WHERE qs.chat_jid = ? ${subjectFilter}`,
  ).get(...params) as { total: number; correct: number };

  params.length = 1;
  if (subjectId) {
    params.push(subjectId, subjectId);
  }
  const wqStats = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN wq.mastered = 0 THEN 1 ELSE 0 END), 0) as active,
       COALESCE(SUM(CASE WHEN wq.mastered = 1 THEN 1 ELSE 0 END), 0) as mastered,
       COALESCE(SUM(CASE WHEN wq.next_review_at <= ? AND wq.mastered = 0 THEN 1 ELSE 0 END), 0) as due
     FROM wrong_questions wq
     JOIN questions q ON wq.question_id = q.id
     WHERE wq.chat_jid = ? ${wqSubjectFilter}`,
  ).get(now, ...params) as { active: number; mastered: number; due: number };

  return {
    total_quizzes: quizCount.cnt,
    total_answers: answerStats.total,
    correct_answers: answerStats.correct,
    active_wrong_questions: wqStats.active,
    mastered_questions: wqStats.mastered,
    due_reviews: wqStats.due,
  };
}

// ============== Study plan queries ==============

export interface StudyPlanRow {
  id: number;
  chat_jid: string;
  subject_id: number | null;
  title: string;
  plan_data: string;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface PlanTask {
  day: number;
  date: string;
  topic: string;
  task: string;
  completed: boolean;
}

export function createStudyPlan(
  chatJid: string,
  title: string,
  planData: PlanTask[],
  startDate: string,
  endDate: string,
  subjectId?: number,
): number {
  const result = db.prepare(
    `INSERT INTO study_plans (chat_jid, subject_id, title, plan_data, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(chatJid, subjectId || null, title, JSON.stringify(planData), startDate, endDate, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function getStudyPlan(planId: number): (StudyPlanRow & { tasks: PlanTask[] }) | undefined {
  const row = db.prepare(
    "SELECT id, chat_jid, subject_id, title, plan_data, start_date, end_date, created_at FROM study_plans WHERE id = ?",
  ).get(planId) as StudyPlanRow | undefined;
  if (!row) return undefined;
  const tasks = JSON.parse(row.plan_data) as PlanTask[];
  return { ...row, tasks };
}

export function getActiveStudyPlan(chatJid: string): (StudyPlanRow & { tasks: PlanTask[] }) | undefined {
  const row = db.prepare(
    `SELECT id, chat_jid, subject_id, title, plan_data, start_date, end_date, created_at
     FROM study_plans WHERE chat_jid = ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(chatJid) as StudyPlanRow | undefined;
  if (!row) return undefined;
  const tasks = JSON.parse(row.plan_data) as PlanTask[];
  return { ...row, tasks };
}

export function markPlanTaskDone(planId: number, dayIndex: number): PlanTask[] | null {
  const plan = getStudyPlan(planId);
  if (!plan) return null;
  if (dayIndex < 0 || dayIndex >= plan.tasks.length) return null;
  plan.tasks[dayIndex].completed = true;
  db.prepare("UPDATE study_plans SET plan_data = ? WHERE id = ?").run(
    JSON.stringify(plan.tasks),
    planId,
  );
  return plan.tasks;
}

export function getStudyPlanProgress(planId: number): {
  total: number;
  completed: number;
  percent: number;
  upcoming: PlanTask[];
} | null {
  const plan = getStudyPlan(planId);
  if (!plan) return null;
  const total = plan.tasks.length;
  const completed = plan.tasks.filter((t) => t.completed).length;
  const upcoming = plan.tasks.filter((t) => !t.completed).slice(0, 5);
  return {
    total,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    upcoming,
  };
}

export function getStudyPlansByJid(chatJid: string): StudyPlanRow[] {
  return db.prepare(
    `SELECT id, chat_jid, subject_id, title, plan_data, start_date, end_date, created_at
     FROM study_plans WHERE chat_jid = ? ORDER BY created_at DESC`,
  ).all(chatJid) as StudyPlanRow[];
}

// ============== Session context queries ==============

export interface SessionContext {
  chat_jid: string;
  topic: string | null;
  weak_areas: string | null;
  summary: string | null;
  updated_at: string;
}

export function getRecentMessages(
  chatJid: string,
  limit: number,
  excludeBot?: boolean,
): NewMessage[] {
  let query = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages WHERE chat_jid = ?
  `;
  if (excludeBot) {
    query += " AND is_bot_message = 0";
  }
  query += " ORDER BY timestamp DESC LIMIT ?";
  return db.prepare(query).all(chatJid, limit).reverse() as NewMessage[];
}

export function getSessionContext(chatJid: string): SessionContext | undefined {
  return db.prepare(
    "SELECT chat_jid, topic, weak_areas, summary, updated_at FROM session_context WHERE chat_jid = ?",
  ).get(chatJid) as SessionContext | undefined;
}

export function upsertSessionContext(
  chatJid: string,
  topic?: string | null,
  weakAreas?: string | null,
  summary?: string | null,
): void {
  const existing = getSessionContext(chatJid);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE session_context
       SET topic = COALESCE(?, topic),
           weak_areas = COALESCE(?, weak_areas),
           summary = COALESCE(?, summary),
           updated_at = ?
       WHERE chat_jid = ?`,
    ).run(
      topic ?? existing.topic,
      weakAreas ?? existing.weak_areas,
      summary ?? existing.summary,
      now,
      chatJid,
    );
  } else {
    db.prepare(
      `INSERT INTO session_context (chat_jid, topic, weak_areas, summary, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(chatJid, topic || null, weakAreas || null, summary || null, now);
  }
}

export function getWeakAreas(chatJid: string): string[] {
  const rows = db.prepare(
    `SELECT s.name as subject, COUNT(*) as cnt
     FROM wrong_questions wq
     JOIN questions q ON wq.question_id = q.id
     LEFT JOIN knowledge_points kp ON q.knowledge_point_id = kp.id
     LEFT JOIN subjects s ON kp.subject_id = s.id
     WHERE wq.chat_jid = ? AND wq.mastered = 0
     GROUP BY s.name
     ORDER BY cnt DESC LIMIT 5`,
  ).all(chatJid) as { subject: string; cnt: number }[];

  return rows.map((r) => `${r.subject} (${r.cnt} wrong)`);
}

// ============== Scheduled task queries ==============

export interface ScheduledTaskRow {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
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
  if (type === "once") {
    return value; // Already an ISO datetime
  }
  if (type === "interval") {
    const minutes = parseInt(value, 10) || 60;
    return new Date(now.getTime() + minutes * 60000).toISOString();
  }
  // Default: 24 hours from now
  return new Date(now.getTime() + 86400000).toISOString();
}

export function getDueScheduledTasks(): ScheduledTaskRow[] {
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
            next_run, last_run, last_result, status, created_at
     FROM scheduled_tasks
     WHERE next_run <= ? AND status = 'active'
     ORDER BY next_run ASC`,
  ).all(now) as ScheduledTaskRow[];
}

export function createScheduledTask(
  groupFolder: string,
  chatJid: string,
  prompt: string,
  scheduleType: string,
  scheduleValue: string,
): string {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextRun = computeNextRun(scheduleType, scheduleValue);
  db.prepare(
    `INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, groupFolder, chatJid, prompt, scheduleType, scheduleValue, nextRun, new Date().toISOString());
  return id;
}

export function updateScheduledTaskRun(
  id: string,
  nextRun: string,
  lastResult?: string,
): void {
  db.prepare(
    `UPDATE scheduled_tasks SET last_run = ?, next_run = ?, last_result = ? WHERE id = ?`,
  ).run(new Date().toISOString(), nextRun, lastResult || null, id);
}

export function cancelScheduledTask(id: string): boolean {
  const result = db.prepare(
    "UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?",
  ).run(id);
  return result.changes > 0;
}

export function getScheduledTasksByJid(chatJid: string): ScheduledTaskRow[] {
  return db.prepare(
    `SELECT id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
            next_run, last_run, last_result, status, created_at
     FROM scheduled_tasks WHERE chat_jid = ? AND status = 'active'
     ORDER BY next_run ASC`,
  ).all(chatJid) as ScheduledTaskRow[];
}
