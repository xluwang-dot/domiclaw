import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { STORE_DIR } from "./config.js";
import { logger } from "./logger.js";
import { initAuthDb } from "./auth.js";
import { NewMessage } from "./types.js";
import { generateEmbedding, float32ToBlob, initEmbedder as initEmbedderForKP } from "./rag/embeddings/embeddingService.js";

let db: Database.Database;

export function getDatabase(): Database.Database {
  return db;
}

export function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_messages (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON user_messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON user_messages(user_id);

    CREATE TABLE IF NOT EXISTS sys_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_cn TEXT,
      alias TEXT,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sys_knowledgepoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL REFERENCES sys_subjects(id),
      parent_id INTEGER REFERENCES sys_knowledgepoints(id),
      level_type TEXT NOT NULL DEFAULT 'knowledge_point',
      sort_order INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      alias TEXT,
      content TEXT,
      prerequisite_ids TEXT,
      related_ids TEXT,
      exercise_point_names TEXT,
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(parent_id, title)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_alias ON sys_knowledgepoints(subject_id, alias) WHERE alias IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_kp_parent ON sys_knowledgepoints(parent_id);
    CREATE INDEX IF NOT EXISTS idx_kp_subject ON sys_knowledgepoints(subject_id);
    CREATE INDEX IF NOT EXISTS idx_kp_level_type ON sys_knowledgepoints(level_type);
    CREATE INDEX IF NOT EXISTS idx_kp_subject_level ON sys_knowledgepoints(subject_id, level_type);
    CREATE INDEX IF NOT EXISTS idx_kp_parent_sort ON sys_knowledgepoints(parent_id, sort_order);

    CREATE TABLE IF NOT EXISTS sys_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_point_id INTEGER,
      knowledge_point_ids TEXT,
      question_text TEXT NOT NULL,
      answer TEXT NOT NULL,
      explanation TEXT,
      difficulty INTEGER DEFAULT 1,
      times_answered INTEGER NOT NULL DEFAULT 0,
      times_correct INTEGER NOT NULL DEFAULT 0,
      question_type TEXT NOT NULL DEFAULT 'short_answer',
      options TEXT,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      FOREIGN KEY (knowledge_point_id) REFERENCES sys_knowledgepoints(id)
    );

    CREATE TABLE IF NOT EXISTS user_quizsessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      total_questions INTEGER DEFAULT 0,
      correct_count INTEGER DEFAULT 0,
      FOREIGN KEY (subject_id) REFERENCES sys_subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_qs_user ON user_quizsessions(user_id);

    CREATE TABLE IF NOT EXISTS user_quizbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_session_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL DEFAULT 0,
      student_answer TEXT,
      is_correct INTEGER DEFAULT 0,
      weak_kp_ids TEXT,
      solution_steps TEXT,
      duration_seconds INTEGER,
      error_reason TEXT,
      answered_at TEXT NOT NULL,
      FOREIGN KEY (quiz_session_id) REFERENCES user_quizsessions(id),
      FOREIGN KEY (question_id) REFERENCES sys_questions(id)
    );

    CREATE TABLE IF NOT EXISTS user_wrongquestions (
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
      FOREIGN KEY (question_id) REFERENCES sys_questions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wq_next_review ON user_wrongquestions(next_review_at);
    CREATE INDEX IF NOT EXISTS idx_wq_user ON user_wrongquestions(user_id);

    CREATE TABLE IF NOT EXISTS user_studyplans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject_id INTEGER,
      title TEXT NOT NULL,
      plan_data TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subject_id) REFERENCES sys_subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sp_user ON user_studyplans(user_id);

    CREATE TABLE IF NOT EXISTS user_scheduledtasks (
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
    CREATE INDEX IF NOT EXISTS idx_st_next_run ON user_scheduledtasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_st_user ON user_scheduledtasks(user_id);

    CREATE TABLE IF NOT EXISTS user_sessioncontext (
      user_id INTEGER PRIMARY KEY,
      topic TEXT,
      weak_areas TEXT,
      summary TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_notebook (
      user_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      kp_id INTEGER NOT NULL,
      mastery REAL NOT NULL DEFAULT 0.5,
      total_wrong INTEGER NOT NULL DEFAULT 0,
      representative_question_id INTEGER,
      last_wrong_time TEXT,
      last_updated TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, subject_id, kp_id)
    );
    CREATE INDEX IF NOT EXISTS idx_un_user ON user_notebook(user_id);
    CREATE INDEX IF NOT EXISTS idx_un_kp ON user_notebook(kp_id);

    CREATE TABLE IF NOT EXISTS sys_querycache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      pattern TEXT NOT NULL,
      intent TEXT NOT NULL,
      params_json TEXT,
      operation_json TEXT NOT NULL,
      hits INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_hit_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_testlevelconfig (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL UNIQUE,
      question_count INTEGER NOT NULL,
      easy_ratio REAL NOT NULL,
      medium_ratio REAL NOT NULL,
      hard_ratio REAL NOT NULL
    );
  `);

  // Seed common subjects on first run
  const count = database.prepare(
    "SELECT COUNT(*) as cnt FROM sys_subjects",
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
      "INSERT INTO sys_subjects (name, name_cn, alias, description, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const s of subjects) {
      insert.run(s.name, s.name_cn, s.alias, null, now);
    }
  }

  // Seed test level config
  const levelCount = database.prepare(
    "SELECT COUNT(*) as cnt FROM user_testlevelconfig",
  ).get() as { cnt: number };
  if (levelCount.cnt === 0) {
    const insert = database.prepare(
      "INSERT INTO user_testlevelconfig (level, question_count, easy_ratio, medium_ratio, hard_ratio) VALUES (?, ?, ?, ?, ?)"
    );
    insert.run(1, 30, 0.7, 0.2, 0.1);
    insert.run(2, 20, 0.4, 0.3, 0.3);
    insert.run(3, 15, 0.1, 0.2, 0.7);
  }
}

/*
module/domain/subject_area → 较大圆角矩形，用于逻辑分组
chapter/unit → 中等矩形，作为主要导航节点
section/concept/lesson → 较小节点
knowledge_point → 最小节点，颜色绑定掌握度，可点击触发测验
*/
// Level compatibility: parent → allowed children
const LEVEL_RULES: Record<string, string[]> = {
/*
  "root": ["module", "domain", "unit", "chapter", "section", "knowledge_point"],
  "module": ["chapter", "unit", "knowledge_point"],
  "domain": ["chapter", "unit", "knowledge_point"],
  "unit": ["chapter", "section", "knowledge_point"],
  "chapter": ["knowledge_point"],
  "section": ["knowledge_point"],
  "knowledge_point": ["knowledge_point"], // allows nesting for finer granularity
  */
  "root": ["module","domain","subject_area","chapter","unit","section","concept","lesson","knowledge_point"],
  "module":["chapter","unit","section","concept","lesson","knowledge_point"],
  "domain":["chapter","unit","section","concept","lesson","knowledge_point"],
  "subject_area":["chapter","unit","section","concept","lesson","knowledge_point"],
  "chapter":["knowledge_point"],
  "unit":["knowledge_point"],
  "section":["knowledge_point"],
  "concept":["knowledge_point"],
  "lesson":["knowledge_point"],
  "knowledge_point":["knowledge_point"]// allows nesting for finer granularity
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
  const subjects = database.prepare("SELECT id, name, name_cn FROM sys_subjects").all() as { id: number; name: string; name_cn: string | null }[];
  const exists = database.prepare(
    "SELECT 1 FROM sys_knowledgepoints WHERE subject_id = ? AND parent_id IS NULL AND level_type = 'root'",
  );
  const insert = database.prepare(
    `INSERT INTO sys_knowledgepoints (subject_id, parent_id, title, content, level_type, sort_order, created_at, updated_at)
     VALUES (?, NULL, ?, ?, 'root', 0, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const s of subjects) {
    if (!exists.get(s.id)) {
      const title = s.name_cn || s.name;
      insert.run(s.id, title, `${title} 学科根节点`, now, now);
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
    `ALTER TABLE wrong_questions ADD COLUMN root_kp_id INTEGER`,
    `ALTER TABLE wrong_questions ADD COLUMN subject_id INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE knowledge_points ADD COLUMN parent_id INTEGER REFERENCES knowledge_points(id)`,
    `ALTER TABLE knowledge_points ADD COLUMN level_type TEXT NOT NULL DEFAULT 'knowledge_point'`,
    `ALTER TABLE knowledge_points ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE subjects ADD COLUMN name_cn TEXT`,
    `ALTER TABLE subjects ADD COLUMN alias TEXT`,
    `ALTER TABLE knowledge_points ADD COLUMN alias TEXT`,
    `ALTER TABLE knowledge_points ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`,
    `ALTER TABLE query_cache ADD COLUMN user_id INTEGER`,
    `ALTER TABLE questions ADD COLUMN times_answered INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE questions ADD COLUMN times_correct INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE knowledge_points ADD COLUMN prerequisite_ids TEXT`,
    `ALTER TABLE knowledge_points ADD COLUMN related_ids TEXT`,
    `ALTER TABLE sys_knowledgepoints ADD COLUMN embedding BLOB`,
  ]) {
    try { db.exec(stmt); } catch { /* column already exists — skip */ }
  }
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_questions_user ON sys_questions(user_id)"); } catch { /* ok */ }
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_kp_parent ON knowledge_points(parent_id)"); } catch { /* ok */ }
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_parent_title ON knowledge_points(parent_id, title) WHERE parent_id IS NOT NULL"); } catch { /* ok */ }
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_alias ON knowledge_points(subject_id, alias) WHERE alias IS NOT NULL"); } catch { /* ok */ }
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_qc_user_pattern ON query_cache(user_id, pattern)"); } catch { /* ok */ }
  try { db.exec("DROP INDEX IF EXISTS idx_qc_pattern"); } catch { /* ok */ }

  // Drop exam_papers table (removed in T056)
  try { db.exec("DROP TABLE IF EXISTS exam_papers"); } catch { /* ok */ }

  // Table prefix migration (T054): system → sys_, user → user_
  const tableRenames: [string, string][] = [
    ["subjects", "sys_subjects"],
    ["knowledge_points", "sys_knowledgepoints"],
    ["query_cache", "sys_querycache"],
    ["users", "sys_users"],
    ["messages", "user_messages"],
    ["quiz_sessions", "user_quizsessions"],
    ["wrong_questions", "user_wrongquestions"],
    ["study_plans", "user_studyplans"],
    ["scheduled_tasks", "user_scheduledtasks"],
    ["session_context", "user_sessioncontext"],
  ];
  for (const [oldName, newName] of tableRenames) {
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(oldName);
      if (exists) {
        db.exec(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
      }
    } catch { /* already migrated — skip */ }
  }

  // Rename questions → sys_questions (T053)
  try {
    const hasOldQuestions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='questions'").get();
    if (hasOldQuestions) {
      db.exec("ALTER TABLE questions RENAME TO sys_questions");
    }
  } catch { /* already migrated — skip */ }

  // Rename user_quizbook → user_quizbook + add new columns
  try {
    const hasOldAnswers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_quizbook'").get();
    if (hasOldAnswers) {
      db.exec(`
        ALTER TABLE user_quizbook RENAME TO user_quizbook;
        ALTER TABLE user_quizbook ADD COLUMN solution_steps TEXT;
        ALTER TABLE user_quizbook ADD COLUMN duration_seconds INTEGER;
        ALTER TABLE user_quizbook ADD COLUMN error_reason TEXT;
      `);
    }
  } catch { /* already migrated — skip */ }

  // Migrate exercise_points → knowledge_points.exercise_point_names
  try {
    const hasOldEp = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='exercise_points'").get();
    if (hasOldEp) {
      // Step 1: add column if not exists
      try { db.exec("ALTER TABLE knowledge_points ADD COLUMN exercise_point_names TEXT"); } catch { /* ok */ }

      // Step 2: migrate existing exercise point names per KP
      const rows = db.prepare(`
        SELECT epk.knowledge_point_id, ep.name
        FROM exercise_point_knowledge_points epk
        JOIN exercise_points ep ON ep.id = epk.exercise_point_id
      `).all() as { knowledge_point_id: number; name: string }[];

      const kpMap = new Map<number, string[]>();
      for (const r of rows) {
        if (!kpMap.has(r.knowledge_point_id)) kpMap.set(r.knowledge_point_id, []);
        kpMap.get(r.knowledge_point_id)!.push(r.name);
      }

      const update = db.prepare(
        "UPDATE sys_knowledgepoints SET exercise_point_names = ? WHERE id = ?"
      );
      for (const [kpId, names] of kpMap) {
        update.run(JSON.stringify(names), kpId);
      }

      // Step 3: drop old tables
      db.exec("DROP TABLE IF EXISTS exercise_point_questions");
      db.exec("DROP TABLE IF EXISTS exercise_point_knowledge_points");
      db.exec("DROP TABLE IF EXISTS exercise_points");
    }
  } catch { /* already migrated — skip */ }

  // Migrate tags->alias: extract en from {"en":"rational_number"} JSON
  try {
    const rows = db.prepare("SELECT id, tags FROM sys_knowledgepoints WHERE tags IS NOT NULL AND alias IS NULL").all() as { id: number; tags: string }[];
    const update = db.prepare("UPDATE sys_knowledgepoints SET alias = ? WHERE id = ?");
    for (const r of rows) {
      try {
        const obj = JSON.parse(r.tags);
        if (obj.en) update.run(obj.en, r.id);
      } catch { /* not JSON — skip */ }
    }
  } catch { /* migration already done */ }
  // Drop tags column (SQLite 3.35+)
  try { db.exec("ALTER TABLE knowledge_points DROP COLUMN tags"); } catch { /* already dropped */ }

  // Merge user_kp_mastery + user_kp_weakness → user_notebook
  try {
    const hasOldMastery = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_kp_mastery'").get();
    if (hasOldMastery) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_notebook (
          user_id INTEGER NOT NULL,
          subject_id INTEGER NOT NULL,
          kp_id INTEGER NOT NULL,
          mastery REAL NOT NULL DEFAULT 0.5,
          total_wrong INTEGER NOT NULL DEFAULT 0,
          representative_question_id INTEGER,
          last_wrong_time TEXT,
          last_updated TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, subject_id, kp_id)
        );
        INSERT OR IGNORE INTO user_notebook (user_id, subject_id, kp_id, mastery, total_wrong, representative_question_id, last_wrong_time, last_updated)
          SELECT m.user_id, m.subject_id, m.kp_id, m.mastery,
            COALESCE(w.total_wrong, 0), w.representative_question_id, w.last_wrong_time,
            m.last_updated
          FROM user_kp_mastery m
          LEFT JOIN user_kp_weakness w
            ON m.user_id = w.user_id AND m.subject_id = w.subject_id AND m.kp_id = w.kp_id;
        INSERT OR IGNORE INTO user_notebook (user_id, subject_id, kp_id, mastery, total_wrong, representative_question_id, last_wrong_time, last_updated)
          SELECT w.user_id, w.subject_id, w.kp_id, 0.5,
            w.total_wrong, w.representative_question_id, w.last_wrong_time,
            w.last_wrong_time
          FROM user_kp_weakness w
          WHERE NOT EXISTS (
            SELECT 1 FROM user_kp_mastery m
            WHERE m.user_id = w.user_id AND m.subject_id = w.subject_id AND m.kp_id = w.kp_id
          );
        DROP TABLE IF EXISTS user_kp_mastery;
        DROP TABLE IF EXISTS user_kp_weakness;
        CREATE INDEX IF NOT EXISTS idx_un_user ON user_notebook(user_id);
        CREATE INDEX IF NOT EXISTS idx_un_kp ON user_notebook(kp_id);
      `);
    }
  } catch { /* already migrated — skip */ }

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
    "UPDATE sys_subjects SET name_cn = ?, alias = ? WHERE name = ? AND name_cn IS NULL",
  );
  for (const [name, info] of Object.entries(nameCnMap)) {
    updateSubject.run(info.name_cn, info.alias, name);
  }

  // Create root KP nodes for existing subjects that lack one (idempotent)
  ensureRootKnowledgePoints(db);

  // Init auth module
  initAuthDb(db);

  // Seed query cache patterns (system-level)
  try {
    seedQueryCache();
  } catch { /* ok */ }
}

// ============== Message queries ==============

export function storeMessage(msg: NewMessage, userId: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO user_messages
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
    FROM user_messages WHERE user_id = ? AND timestamp > ?
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
    "SELECT id, name, name_cn, alias, description FROM sys_subjects ORDER BY name",
  ).all() as SubjectRow[];
}

export function getSubjectByName(name: string): SubjectRow | undefined {
  return db.prepare(
    `SELECT id, name, name_cn, alias, description FROM sys_subjects
     WHERE name = ? OR name_cn = ? OR alias = ?`,
  ).get(name, name, name) as SubjectRow | undefined;
}

export function addSubject(
  name: string, description: string | null,
  nameCn: string | null = null, alias: string | null = null,
): number {
  const result = db.prepare(
    "INSERT INTO sys_subjects (name, name_cn, alias, description, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(name, nameCn, alias, description, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function updateSubject(id: number, name: string, description: string | null): boolean {
  const result = db.prepare(
    "UPDATE sys_subjects SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
  ).run(name, description, id);
  return result.changes > 0;
}

export function deleteSubject(id: number): boolean {
  const result = db.prepare("DELETE FROM sys_subjects WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============== Knowledge point queries ==============

export interface KnowledgePointRow {
  id: number; subject_id: number; parent_id: number | null;
  level_type: string; sort_order: number;
  title: string; alias: string | null; content: string | null;
  created_at: string; updated_at: string;
  prerequisite_ids: string | null; related_ids: string | null;
  exercise_point_names: string | null;
}

export function addKnowledgePoint(
  subjectId: number, title: string, content?: string | null,
  parentId?: number | null, levelType?: string, sortOrder?: number,
  alias?: string | null,
  prerequisiteIds?: string | null,
  relatedIds?: string | null,
): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO sys_knowledgepoints (subject_id, parent_id, title, content, level_type, sort_order, alias, prerequisite_ids, related_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(subjectId, parentId || null, title, content || null, levelType || "knowledge_point", sortOrder || 0, alias || null, prerequisiteIds || null, relatedIds || null, now, now);
  return result.lastInsertRowid as number;
}

const KP_SELECT = `id, subject_id, parent_id, level_type, sort_order, title, alias, content, prerequisite_ids, related_ids, exercise_point_names, created_at, updated_at`;

export function searchKnowledgePoints(query: string, subjectId?: number): KnowledgePointRow[] {
  const like = `%${query}%`;
  if (subjectId) {
    return db.prepare(
      `SELECT ${KP_SELECT} FROM sys_knowledgepoints
       WHERE (title LIKE ? OR content LIKE ? OR alias LIKE ?) AND subject_id = ?
       ORDER BY level_type, sort_order, title LIMIT 20`,
    ).all(like, like, like, subjectId) as KnowledgePointRow[];
  }
  return db.prepare(
    `SELECT ${KP_SELECT} FROM sys_knowledgepoints
     WHERE title LIKE ? OR content LIKE ? OR alias LIKE ?
     ORDER BY level_type, sort_order, title LIMIT 20`,
  ).all(like, like, like) as KnowledgePointRow[];
}

export function getKnowledgePointById(id: number): KnowledgePointRow | undefined {
  return db.prepare(`SELECT ${KP_SELECT} FROM sys_knowledgepoints WHERE id = ?`).get(id) as KnowledgePointRow | undefined;
}

export function getKnowledgePointsBySubject(subjectId: number): KnowledgePointRow[] {
  return db.prepare(
    `SELECT ${KP_SELECT} FROM sys_knowledgepoints WHERE subject_id = ? ORDER BY level_type, sort_order, title`,
  ).all(subjectId) as KnowledgePointRow[];
}

export function getAllKnowledgePoints(): KnowledgePointRow[] {
  return db.prepare(
    `SELECT ${KP_SELECT} FROM sys_knowledgepoints ORDER BY subject_id, level_type, sort_order, title`,
  ).all() as KnowledgePointRow[];
}

export function updateKnowledgePoint(
  id: number, title?: string, content?: string | null,
  alias?: string | null, parentId?: number | null,
  levelType?: string, sortOrder?: number,
  exercisePointNames?: string | null,
): boolean {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE sys_knowledgepoints
     SET title = COALESCE(?, title), content = COALESCE(?, content),
         alias = COALESCE(?, alias), parent_id = COALESCE(?, parent_id),
         level_type = COALESCE(?, level_type), sort_order = COALESCE(?, sort_order),
         exercise_point_names = COALESCE(?, exercise_point_names),
         updated_at = ?
     WHERE id = ?`,
  ).run(
    title || null, content !== undefined ? content : null,
    alias !== undefined ? alias : null,
    parentId !== undefined ? (parentId ?? null) : null,
    levelType || null, sortOrder ?? null,
    exercisePointNames !== undefined ? exercisePointNames : null,
    now, id,
  );
  return result.changes > 0;
}

/**
 * 更新知识点的横向关联关系
 * @param id 知识点ID
 * @param prerequisiteIds 前置知识点ID数组（JSON字符串），传null清空
 * @param relatedIds 关联知识点ID数组（JSON字符串），传null清空
 */
export function updateKnowledgePointRelations(
  id: number,
  prerequisiteIds: string | null,
  relatedIds: string | null,
): boolean {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE sys_knowledgepoints
     SET prerequisite_ids = ?, related_ids = ?, updated_at = ?
     WHERE id = ?`,
  ).run(prerequisiteIds, relatedIds, now, id);
  return result.changes > 0;
}

export function deleteKnowledgePoint(id: number): boolean {
  const result = db.prepare("DELETE FROM sys_knowledgepoints WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============== Embedding generation ==============

export async function generateKPEmbedding(kpId: number): Promise<boolean> {
  const kp = getKnowledgePointById(kpId);
  if (!kp) return false;
  const text = `${kp.title}: ${kp.content || ""}`;
  try {
    const vector = await generateEmbedding(text);
    db.prepare("UPDATE sys_knowledgepoints SET embedding = ? WHERE id = ?")
      .run(float32ToBlob(vector), kpId);
    return true;
  } catch {
    return false;
  }
}

export async function rebuildAllEmbeddings(): Promise<number> {
  const rows = db.prepare(
    `SELECT id, title, content FROM sys_knowledgepoints WHERE embedding IS NULL`,
  ).all() as { id: number; title: string; content: string | null }[];
  if (rows.length === 0) return 0;
  await initEmbedderForKP();
  let count = 0;
  for (const row of rows) {
    const text = `${row.title}: ${row.content || ""}`;
    try {
      const vector = await generateEmbedding(text);
      db.prepare("UPDATE sys_knowledgepoints SET embedding = ? WHERE id = ?")
        .run(float32ToBlob(vector), row.id);
      count++;
    } catch { /* skip failed */ }
  }
  return count;
}

// ============== Exam paper queries ==============

// ============== Question queries ==============

export function addQuestion(
  knowledgePointId: number | null,
  questionText: string, answer: string, questionType: string,
  explanation?: string, difficulty?: number, options?: string,
  knowledgePointIds?: string | null,
): number {
  const result = db.prepare(
    `INSERT INTO sys_questions (knowledge_point_id, knowledge_point_ids,
       question_text, answer, explanation, difficulty, question_type, options, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(knowledgePointId, knowledgePointIds || null, questionText, answer,
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
}

export function getQuestionsBySubject(subjectId: number, limit = 50): QuestionRow[] {
  return db.prepare(
    `SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type,
            q.options, q.knowledge_point_id, q.knowledge_point_ids
     FROM sys_questions q
     JOIN sys_knowledgepoints kp ON q.knowledge_point_id = kp.id
     WHERE kp.subject_id = ? AND q.status = 'published'
     LIMIT 500`,
  ).all(subjectId) as QuestionRow[];
}

export function getQuestionsByKnowledgePoint(knowledgePointId: number): QuestionRow[] {
  return db.prepare(
    `SELECT id, question_text, answer, explanation, difficulty, question_type,
            options, knowledge_point_id, knowledge_point_ids
     FROM sys_questions WHERE knowledge_point_id = ? AND status = 'published'`,
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
    FROM sys_questions
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
  db.prepare("UPDATE sys_questions SET explanation = ? WHERE id = ?").run(explanation, id);
}

export function getQuestionById(id: number): QuestionRow | undefined {
  return db.prepare(
    `SELECT id, question_text, answer, explanation, difficulty, question_type,
            options, knowledge_point_id
     FROM sys_questions WHERE id = ?`,
  ).get(id) as QuestionRow | undefined;
}

/**
 * 更新题目答题统计
 * @param questionId 题目ID
 * @param isCorrect 是否回答正确
 */
export function updateQuestionStats(questionId: number, isCorrect: boolean): void {
  db.prepare("UPDATE sys_questions SET times_answered = times_answered + 1 WHERE id = ?").run(questionId);
  if (isCorrect) {
    db.prepare("UPDATE sys_questions SET times_correct = times_correct + 1 WHERE id = ?").run(questionId);
  }
}

/**
 * 获取题目的经验校准难度
 * 经验难度 = 1 - (times_correct / times_answered)
 * 最终难度 = (1 - 可信度) × 初始难度 + 可信度 × 经验难度
 * 可信度 = min(times_answered / 20, 1)
 * @param questionId 题目ID
 * @returns 计算后的难度值
 */
export function getQuestionDifficulty(questionId: number): number {
  const row = db.prepare(
    `SELECT difficulty, times_answered, times_correct FROM sys_questions WHERE id = ?`
  ).get(questionId) as { difficulty: number; times_answered: number; times_correct: number } | undefined;

  if (!row) return 1;
  if (row.times_answered === 0) return row.difficulty;

  const empirical = 1 - (row.times_correct / row.times_answered);
  const credibility = Math.min(row.times_answered / 20, 1);
  return (1 - credibility) * row.difficulty + credibility * empirical;
}


export function updateQuestion(id: number, fields: Record<string, unknown>): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const allowed = ["question_text", "answer", "explanation", "difficulty",
      "question_type", "options", "status", "knowledge_point_id"];
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return false;
  vals.push(id);
  const result = db.prepare(
    `UPDATE sys_questions SET ${sets.join(", ")} WHERE id = ?`,
  ).run(...vals);
  return result.changes > 0;
}

export function deleteQuestion(id: number): boolean {
  const result = db.prepare("DELETE FROM sys_questions WHERE id = ?").run(id);
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
): number {
  const result = db.prepare(
    `INSERT INTO sys_questions (user_id, knowledge_point_id, question_text, answer,
       explanation, difficulty, question_type, options, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
  ).run(userId, kpId || null, questionText, answer,
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
    `SELECT COUNT(*) as cnt FROM sys_questions q WHERE ${where}`,
  ).get(...params) as { cnt: number };

  const questions = db.prepare(
    `    SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type,
            q.options, q.knowledge_point_id, q.status
     FROM sys_questions q
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
    "question_type", "options", "status", "knowledge_point_id"];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return false;
  vals.push(id, userId);
  const result = db.prepare(
    `UPDATE sys_questions SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  ).run(...vals);
  return result.changes > 0;
}

export function deleteUserQuestion(id: number, userId: number): boolean {
  const result = db.prepare(
    "DELETE FROM sys_questions WHERE id = ? AND user_id = ?",
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
  }[],
): { imported: number } {
  const stmt = db.prepare(
    `INSERT INTO sys_questions (user_id, knowledge_point_id, question_text, answer,
       explanation, difficulty, question_type, options, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction(() => {
    let count = 0;
    for (const q of items) {
      stmt.run(userId, q.knowledge_point_id || null,
        q.question_text, q.answer, q.explanation || null,
        q.difficulty || 1, q.question_type || "short_answer",
        q.options || null, now);
      count++;
    }
    return count;
  });
  return { imported: insertMany() };
}

/**
 * 设置测试数据库（仅测试环境使用）
 * 替换模块内部的 db 实例为传入的 :memory: 数据库
 */
export function useTestDatabase(testDb: Database.Database): void {
  db = testDb;
}

// Admin: paginated questions with filters
export function getAllDescendantKpIds(rootId: number): number[] {
  const result: number[] = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = db.prepare(
      "SELECT id FROM sys_knowledgepoints WHERE parent_id = ?",
    ).all(parentId) as { id: number }[];
    for (const c of children) {
      result.push(c.id);
      queue.push(c.id);
    }
  }
  return result;
}

export function getQuestionsAdmin(opts?: {
  subjectId?: number; kpId?: number; status?: string; page?: number; limit?: number;
}): { questions: QuestionRow[]; total: number } {
  const page = Math.max(1, opts?.page || 1);
  const limit = Math.min(100, Math.max(1, opts?.limit || 20));
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.subjectId) {
    conditions.push(`q.knowledge_point_id IN (SELECT id FROM sys_knowledgepoints WHERE subject_id = ?)`);
    params.push(opts.subjectId);
  }
  if (opts?.kpId) {
    const kpIds = getAllDescendantKpIds(opts.kpId);
    const placeholders = kpIds.map(() => "?").join(",");
    conditions.push(`q.knowledge_point_id IN (${placeholders})`);
    params.push(...kpIds);
  }
  if (opts?.status) {
    conditions.push("q.status = ?");
    params.push(opts.status);
  }
  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const totalRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM sys_questions q ${where}`,
  ).get(...params) as { cnt: number };

  const questions = db.prepare(
    `SELECT q.id, q.question_text, q.answer, q.explanation, q.difficulty, q.question_type,
            q.options, q.knowledge_point_id, q.status, q.user_id
     FROM sys_questions q ${where}
     ORDER BY q.created_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, limit, (page - 1) * limit) as QuestionRow[];

  return { questions, total: totalRow.cnt };
}

export function toggleQuestionStatus(id: number): string | null {
  const row = db.prepare("SELECT status FROM sys_questions WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row) return null;
  const next = row.status === "published" ? "draft" : "published";
  db.prepare("UPDATE sys_questions SET status = ? WHERE id = ?").run(next, id);
  return next;
}

export function findDuplicateQuestions(text: string): { id: number; question_text: string }[] {
  // Simple similarity: find questions whose text shares at least 60% common words
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return [];
  const patterns = words.slice(0, 3).map(w => `%${w}%`);
  const placeholders = patterns.map(() => "question_text LIKE ?").join(" OR ");
  return db.prepare(
    `SELECT id, question_text FROM sys_questions WHERE ${placeholders} LIMIT 10`,
  ).all(...patterns) as { id: number; question_text: string }[];
}

export function bulkImportQuestionsAdmin(
  items: {
    question_text: string; answer: string; question_type?: string;
    explanation?: string; difficulty?: number; options?: string;
    knowledge_point_id?: number; status?: string; user_id?: number;
  }[],
): { imported: number } {
  const stmt = db.prepare(
    `INSERT INTO sys_questions (user_id, knowledge_point_id, question_text, answer,
       explanation, difficulty, question_type, options, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction(() => {
    let count = 0;
    for (const q of items) {
      stmt.run(q.user_id || null, q.knowledge_point_id || null,
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
     FROM user_quizbook qa JOIN user_quizsessions qs ON qa.quiz_session_id = qs.id
     WHERE qs.user_id = ?`,
  ).get(userId) as { total: number; correct: number };

  const activeDays = db.prepare(
    `SELECT COUNT(DISTINCT DATE(timestamp)) as cnt FROM user_messages WHERE user_id = ?`,
  ).get(userId) as { cnt: number };

  const plans = db.prepare(
    "SELECT COUNT(*) as cnt FROM user_studyplans WHERE user_id = ?",
  ).get(userId) as { cnt: number };

  const quizzes = db.prepare(
    "SELECT COUNT(*) as cnt FROM user_quizsessions WHERE user_id = ?",
  ).get(userId) as { cnt: number };

  const weakKps = db.prepare(
    "SELECT COUNT(*) as cnt FROM user_notebook WHERE user_id = ? AND total_wrong > 0",
  ).get(userId) as { cnt: number };

  const masteryRows = db.prepare(
    "SELECT mastery FROM user_notebook WHERE user_id = ?",
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
    db.prepare("DELETE FROM user_messages WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_quizbook WHERE quiz_session_id IN (SELECT id FROM user_quizsessions WHERE user_id = ?)").run(userId);
    db.prepare("DELETE FROM user_quizsessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_wrongquestions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_studyplans WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_scheduledtasks WHERE user_id = ?").run(String(userId));
    db.prepare("DELETE FROM user_sessioncontext WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_notebook WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM sys_questions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM sys_users WHERE id = ?").run(userId);
  });
  del();
}

// ============== Quiz session queries ==============

export function createQuizSession(subjectId: number, userId: number): number {
  const result = db.prepare(
    "INSERT INTO user_quizsessions (subject_id, user_id, started_at) VALUES (?, ?, ?)",
  ).run(subjectId, userId, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function recordQuizAnswer(
  sessionId: number, subjectId: number, questionId: number,
  studentAnswer: string, isCorrect: boolean,
  weakKpIds?: number[],
): void {
  db.prepare(
    `INSERT INTO user_quizbook (quiz_session_id, subject_id, question_id, student_answer, is_correct, weak_kp_ids, answered_at)
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
    `UPDATE user_quizbook SET weak_kp_ids = ? WHERE quiz_session_id = ? AND question_id = ?`,
  ).run(JSON.stringify(kpIds), sessionId, questionId);
}

export function finishQuizSession(sessionId: number): { total: number; correct: number } {
  const stats = db.prepare(
    "SELECT COUNT(*) as total, COALESCE(SUM(is_correct), 0) as correct FROM user_quizbook WHERE quiz_session_id = ?",
  ).get(sessionId) as { total: number; correct: number };
  db.prepare(
    "UPDATE user_quizsessions SET finished_at = ?, total_questions = ?, correct_count = ? WHERE id = ?",
  ).run(new Date().toISOString(), stats.total, stats.correct, sessionId);
  return stats;
}

export function getQuizSessionById(sessionId: number): {
  id: number; subject_id: number; user_id: number;
  started_at: string; finished_at: string | null;
  total_questions: number; correct_count: number;
} | undefined {
  return db.prepare(
    "SELECT * FROM user_quizsessions WHERE id = ?",
  ).get(sessionId) as any;
}

export function getQuizSessionQuestions(sessionId: number): {
  question_id: number; question_text: string; question_type: string;
  options: string | null; student_answer: string | null; is_correct: number | null;
}[] {
  return db.prepare(`
    SELECT qb.question_id, q.question_text, q.question_type, q.options,
           qb.student_answer, qb.is_correct
    FROM user_quizbook qb
    JOIN sys_questions q ON q.id = qb.question_id
    WHERE qb.quiz_session_id = ?
    ORDER BY qb.answered_at ASC
  `).all(sessionId) as any[];
}

export function getActiveQuizSession(userId: number): {
  id: number; subject_id: number; started_at: string;
} | undefined {
  return db.prepare(
    `SELECT id, subject_id, started_at FROM user_quizsessions
     WHERE user_id = ? AND finished_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).get(userId) as { id: number; subject_id: number; started_at: string } | undefined;
}

export function getQuizSessionAnswers(sessionId: number): {
  question_id: number; student_answer: string; is_correct: number;
}[] {
  return db.prepare(
    "SELECT question_id, student_answer, is_correct FROM user_quizbook WHERE quiz_session_id = ?",
  ).all(sessionId) as { question_id: number; student_answer: string; is_correct: number }[];
}

// ============== Wrong question / Spaced repetition ==============

export function recordWrongQuestion(questionId: number, userId: number, subjectId: number): void {
  const existing = db.prepare(
    "SELECT id, wrong_count FROM user_wrongquestions WHERE question_id = ? AND user_id = ?",
  ).get(questionId, userId) as { id: number; wrong_count: number } | undefined;

  const now = new Date();
  const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (existing) {
    db.prepare(
      `UPDATE user_wrongquestions
       SET wrong_count = ?, subject_id = ?, consecutive_correct = 0, last_reviewed_at = ?,
           next_review_at = ?, review_interval_days = 1, mastered = 0
       WHERE id = ?`,
    ).run(existing.wrong_count + 1, subjectId, now.toISOString(), nextReview.toISOString(), existing.id);
  } else {
    db.prepare(
      `INSERT INTO user_wrongquestions (question_id, user_id, wrong_count, consecutive_correct,
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
    FROM user_wrongquestions wq
    JOIN sys_questions q ON wq.question_id = q.id
    WHERE wq.user_id = ? AND wq.next_review_at <= ? AND wq.mastered = 0`;
  if (subjectId) {
    query += ` AND q.knowledge_point_id IN (SELECT id FROM sys_knowledgepoints WHERE subject_id = ?)`;
    return db.prepare(query + " ORDER BY wq.next_review_at ASC LIMIT 20").all(
      userId, now, subjectId,
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
    "SELECT consecutive_correct, review_interval_days FROM user_wrongquestions WHERE id = ?",
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
      `UPDATE user_wrongquestions
       SET consecutive_correct = ?, last_reviewed_at = ?, next_review_at = ?,
           review_interval_days = ?, mastered = ?
       WHERE id = ?`,
    ).run(newConsecutive, now.toISOString(), nextReview.toISOString(), newInterval, mastered, wrongQuestionId);

    return { consecutive_correct: newConsecutive, mastered: mastered === 1, next_review_at: nextReview.toISOString() };
  }

  const nextReview = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  db.prepare(
    `UPDATE user_wrongquestions
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
       FROM user_wrongquestions wq
       JOIN sys_questions q ON wq.question_id = q.id
       LEFT JOIN sys_knowledgepoints kp ON q.knowledge_point_id = kp.id
       LEFT JOIN sys_subjects s ON kp.subject_id = s.id
       WHERE wq.user_id = ? AND s.id = ?
       ORDER BY wq.wrong_count DESC`,
    ).all(userId, subjectId) as {
      question_text: string; answer: string; wrong_count: number; mastered: number; subject_name: string;
    }[];
  }
  return db.prepare(
    `SELECT q.question_text, q.answer, wq.wrong_count, wq.mastered, COALESCE(s.name, 'Unknown') as subject_name
     FROM user_wrongquestions wq
     JOIN sys_questions q ON wq.question_id = q.id
     LEFT JOIN sys_knowledgepoints kp ON q.knowledge_point_id = kp.id
     LEFT JOIN sys_subjects s ON kp.subject_id = s.id
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
    "SELECT COUNT(*) as cnt FROM user_quizsessions WHERE user_id = ?" +
    (subjectId ? " AND subject_id = ?" : ""),
  ).get(userId, ...(subjectId ? [subjectId] : [])) as { cnt: number };

  const answerStats = db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(is_correct), 0) as correct
     FROM user_quizbook qa
     JOIN user_quizsessions qs ON qa.quiz_session_id = qs.id
     WHERE qs.user_id = ?` +
    (subjectId ? " AND qs.subject_id = ?" : ""),
  ).get(userId, ...(subjectId ? [subjectId] : [])) as { total: number; correct: number };

  const wqParams: (number | string)[] = [userId];
  if (subjectId) {
    wqParams.push(subjectId);
  }
  const wqStats = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN wq.mastered = 0 THEN 1 ELSE 0 END), 0) as active,
       COALESCE(SUM(CASE WHEN wq.mastered = 1 THEN 1 ELSE 0 END), 0) as mastered,
       COALESCE(SUM(CASE WHEN wq.next_review_at <= ? AND wq.mastered = 0 THEN 1 ELSE 0 END), 0) as due
     FROM user_wrongquestions wq
     JOIN sys_questions q ON wq.question_id = q.id
     WHERE wq.user_id = ?` +
    (subjectId
      ? ` AND q.knowledge_point_id IN (SELECT id FROM sys_knowledgepoints WHERE subject_id = ?)`
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
    `INSERT INTO user_studyplans (user_id, subject_id, title, plan_data, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, subjectId || null, title, JSON.stringify(planData), startDate, endDate, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function getStudyPlan(planId: number): (StudyPlanRow & { tasks: PlanTask[] }) | undefined {
  const row = db.prepare(
    "SELECT id, user_id, subject_id, title, plan_data, start_date, end_date, created_at FROM user_studyplans WHERE id = ?",
  ).get(planId) as StudyPlanRow | undefined;
  if (!row) return undefined;
  const tasks = JSON.parse(row.plan_data) as PlanTask[];
  return { ...row, tasks };
}

export function getActiveStudyPlan(userId: number): (StudyPlanRow & { tasks: PlanTask[] }) | undefined {
  const row = db.prepare(
    `SELECT id, user_id, subject_id, title, plan_data, start_date, end_date, created_at
     FROM user_studyplans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
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
  db.prepare("UPDATE user_studyplans SET plan_data = ? WHERE id = ?").run(JSON.stringify(plan.tasks), planId);
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
     FROM user_studyplans WHERE user_id = ? ORDER BY created_at DESC`,
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
    FROM user_messages WHERE user_id = ?
  `;
  if (excludeBot) query += " AND is_bot_message = 0";
  query += " ORDER BY timestamp DESC LIMIT ?";
  return db.prepare(query).all(userId, limit).reverse() as NewMessage[];
}

export function getSessionContext(userId: number): SessionContext | undefined {
  return db.prepare(
    "SELECT user_id, topic, weak_areas, summary, updated_at FROM user_sessioncontext WHERE user_id = ?",
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
      `UPDATE user_sessioncontext
       SET topic = COALESCE(?, topic), weak_areas = COALESCE(?, weak_areas),
           summary = COALESCE(?, summary), updated_at = ?
       WHERE user_id = ?`,
    ).run(topic ?? existing.topic, weakAreas ?? existing.weak_areas,
      summary ?? existing.summary, now, userId);
  } else {
    db.prepare(
      "INSERT INTO user_sessioncontext (user_id, topic, weak_areas, summary, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, topic || null, weakAreas || null, summary || null, now);
  }
}

export function getWeakAreas(userId: number): string[] {
  const rows = db.prepare(
    `SELECT s.name as subject, COUNT(*) as cnt
     FROM user_wrongquestions wq
     JOIN sys_questions q ON wq.question_id = q.id
     LEFT JOIN sys_knowledgepoints kp ON q.knowledge_point_id = kp.id
     LEFT JOIN sys_subjects s ON kp.subject_id = s.id
     WHERE wq.user_id = ? AND wq.mastered = 0
     GROUP BY s.name ORDER BY cnt DESC LIMIT 5`,
  ).all(userId) as { subject: string; cnt: number }[];

  return rows.map((r) => `${r.subject} (${r.cnt} wrong)`);
}

// ============== Knowledge point mastery (user_notebook) ==============

const KP_MASTERY_ALPHA = 0.2;

export function updateNotebook(
  userId: number,
  subjectId: number,
  kpId: number,
  correct: boolean,
): { mastery: number; previous: number } {
  const existing = db.prepare(
    "SELECT mastery FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?",
  ).get(userId, subjectId, kpId) as { mastery: number } | undefined;

  const previous = existing?.mastery ?? 0.5;
  const target = correct ? 1 : 0;
  const mastery = previous + KP_MASTERY_ALPHA * (target - previous);

  db.prepare(
    `INSERT INTO user_notebook (user_id, subject_id, kp_id, mastery, total_wrong, last_updated)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(user_id, subject_id, kp_id) DO UPDATE SET
       mastery = excluded.mastery,
       last_updated = excluded.last_updated`,
  ).run(userId, subjectId, kpId, mastery, new Date().toISOString());

  return { mastery: Math.round(mastery * 1000) / 1000, previous };
}

export function setWrongQuestionRootKp(
  questionId: number,
  userId: number,
  kpId: number,
): void {
  db.prepare(
    `UPDATE user_wrongquestions SET root_kp_id = COALESCE(root_kp_id, ?)
     WHERE question_id = ? AND user_id = ?`,
  ).run(kpId, questionId, userId);
}

export function notebookAddWrong(
  userId: number,
  subjectId: number,
  kpId: number,
  questionId: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_notebook (user_id, subject_id, kp_id, mastery, total_wrong, representative_question_id, last_wrong_time, last_updated)
     VALUES (?, ?, ?, 0.5, 1, ?, ?, ?)
     ON CONFLICT(user_id, subject_id, kp_id) DO UPDATE SET
       total_wrong = total_wrong + 1,
       representative_question_id = COALESCE(user_notebook.representative_question_id, excluded.representative_question_id),
       last_wrong_time = excluded.last_wrong_time,
       last_updated = excluded.last_updated`,
  ).run(userId, subjectId, kpId, questionId, now, now);
}

export function notebookClearWeakness(userId: number, subjectId: number, kpId: number): boolean {
  const row = db.prepare(
    "SELECT mastery FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?",
  ).get(userId, subjectId, kpId) as { mastery: number } | undefined;
  if (row && row.mastery > 0.8) {
    db.prepare(
      "UPDATE user_notebook SET total_wrong = 0, representative_question_id = NULL WHERE user_id = ? AND subject_id = ? AND kp_id = ?"
    ).run(userId, subjectId, kpId);
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
    `SELECT kp_id, mastery, total_wrong
     FROM user_notebook
     WHERE user_id = ?
     ORDER BY mastery ASC`,
  ).all(userId) as UserKpMasteryRow[];
}

export interface WeakKpRow {
  kp_id: number;
  kp_name: string;
  mastery: number;
  total_wrong: number;
}

export function getNotebookWeakKps(userId: number): WeakKpRow[] {
  return db.prepare(
    `SELECT un.kp_id, kp.title as kp_name, un.mastery, un.total_wrong
     FROM user_notebook un
     JOIN sys_knowledgepoints kp ON kp.id = un.kp_id
     WHERE un.user_id = ? AND un.total_wrong > 0
     ORDER BY un.mastery ASC
     LIMIT 20`,
  ).all(userId) as WeakKpRow[];
}

export function getNotebookStats(userId: number): {
  avg_mastery: number;
  kp_count: number;
  weakness_total: number;
  weakness_cleared: number;
} {
  const rows = db.prepare(
    "SELECT mastery, total_wrong FROM user_notebook WHERE user_id = ?",
  ).all(userId) as { mastery: number; total_wrong: number }[];

  const avg = rows.length > 0
    ? rows.reduce((s, r) => s + r.mastery, 0) / rows.length
    : 0;

  const kp_count = rows.length;
  const weakness_total = rows.filter(r => r.total_wrong > 0).length;
  const masteredCount = rows.filter(r => r.mastery > 0.8).length;

  return {
    avg_mastery: Math.round(avg * 1000) / 1000,
    kp_count,
    weakness_total,
    weakness_cleared: Math.max(0, masteredCount - weakness_total),
  };
}

export interface TestLevelConfig {
  level: number;
  question_count: number;
  easy_ratio: number;
  medium_ratio: number;
  hard_ratio: number;
}

export function getTestLevelConfig(level: number): TestLevelConfig | undefined {
  return db.prepare(
    "SELECT level, question_count, easy_ratio, medium_ratio, hard_ratio FROM user_testlevelconfig WHERE level = ?"
  ).get(level) as TestLevelConfig | undefined;
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
     FROM user_scheduledtasks
     WHERE user_id = ? AND next_run <= ? AND status = 'active'
     ORDER BY next_run ASC`,
  ).all(userId, now) as ScheduledTaskRow[];
}

export function getAllDueScheduledTasks(): ScheduledTaskRow[] {
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT id, user_id, prompt, schedule_type, schedule_value,
            next_run, last_run, last_result, status, created_at
     FROM user_scheduledtasks
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
    `INSERT INTO user_scheduledtasks (id, user_id, prompt, schedule_type, schedule_value, next_run, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, userId, prompt, scheduleType, scheduleValue, nextRun, new Date().toISOString());
  return id;
}

export function updateScheduledTaskRun(id: string, nextRun: string, lastResult?: string): void {
  db.prepare(
    "UPDATE user_scheduledtasks SET last_run = ?, next_run = ?, last_result = ? WHERE id = ?",
  ).run(new Date().toISOString(), nextRun, lastResult || null, id);
}

export function cancelScheduledTask(id: string): boolean {
  const result = db.prepare("UPDATE user_scheduledtasks SET status = 'cancelled' WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getScheduledTasksByUser(userId: number): ScheduledTaskRow[] {
  return db.prepare(
    `SELECT id, user_id, prompt, schedule_type, schedule_value,
            next_run, last_run, last_result, status, created_at
     FROM user_scheduledtasks WHERE user_id = ? AND status = 'active'
     ORDER BY next_run ASC`,
  ).all(userId) as ScheduledTaskRow[];
}

// ── Query Cache ──

export interface QueryCacheRow {
  id: number; user_id: number | null; pattern: string; intent: string;
  params_json: string | null; operation_json: string;
  hits: number; created_at: string; last_hit_at: string;
}

export function findCachedQuery(userInput: string, userId: number): QueryCacheRow | null {
  const norm = normalizePattern(userInput);
  if (!norm) return null;

  for (const userClause of [`(user_id = ? AND pattern = ?)`, `(user_id IS NULL AND pattern = ?)`]) {
    const rows = db.prepare(
      `SELECT * FROM sys_querycache WHERE ${userClause} ORDER BY hits DESC LIMIT 1`,
    ).all(userClause.startsWith("(user_id = ?") ? [userId, norm] : [norm]) as QueryCacheRow[];
    if (rows.length > 0) {
      db.prepare(
        `UPDATE sys_querycache SET hits = hits + 1, last_hit_at = datetime('now') WHERE id = ?`,
      ).run(rows[0].id);
      return rows[0];
    }
  }
  return null;
}

function normalizePattern(text: string): string {
  return text.trim().toLowerCase().replace(/[，。！？、\s]+/g, "");
}

export function insertCachedQuery(
  pattern: string, intent: string, params_json: string | null, operation_json: string,
  userId?: number,
): void {
  const norm = normalizePattern(pattern);
  if (!norm) return;

  const insert = db.prepare(
    `INSERT INTO sys_querycache (user_id, pattern, intent, params_json, operation_json)
     VALUES (?, ?, ?, ?, ?)`,
  );

  if (userId != null && userId > 0) {
    const count = (db.prepare(
      `SELECT COUNT(*) as c FROM sys_querycache WHERE user_id = ?`,
    ).get(userId) as { c: number }).c;
    if (count >= 100) {
      db.prepare(
        `DELETE FROM sys_querycache WHERE id = (
          SELECT id FROM sys_querycache WHERE user_id = ? ORDER BY hits ASC LIMIT 1
        )`,
      ).run(userId);
    }
    insert.run(userId, norm, intent, params_json, operation_json);
  } else {
    const count = (db.prepare(
      `SELECT COUNT(*) as c FROM sys_querycache WHERE user_id IS NULL AND intent = ?`,
    ).get(intent) as { c: number }).c;
    if (count >= 500) {
      db.prepare(
        `DELETE FROM sys_querycache WHERE id = (
          SELECT id FROM sys_querycache WHERE user_id IS NULL AND intent = ? ORDER BY hits ASC LIMIT 1
        )`,
      ).run(intent);
    }
    insert.run(null, norm, intent, params_json, operation_json);
  }
}

export function deleteCachedQuery(id: number): void {
  db.prepare("DELETE FROM sys_querycache WHERE id = ?").run(id);
}

export function purgeOldCache(days: number = 30): number {
  const result = db.prepare(
    `DELETE FROM sys_querycache WHERE last_hit_at < datetime('now', '-' || ? || ' days')`,
  ).run(days);
  return result.changes;
}

export function seedQueryCache(): void {
  const seedPatterns: { pattern: string; intent: string; params_json: string; operation_json: string }[] = [
    { pattern: "我有哪些错题", intent: "query_wrong_questions", params_json: "{}", operation_json: `{"action":"getWrongQuestions","params":{}}` },
    { pattern: "我的错题有哪些", intent: "query_wrong_questions", params_json: "{}", operation_json: `{"action":"getWrongQuestions","params":{}}` },
    { pattern: "错题有哪些", intent: "query_wrong_questions", params_json: "{}", operation_json: `{"action":"getWrongQuestions","params":{}}` },
    { pattern: "今天要复习什么", intent: "query_due_reviews", params_json: "{}", operation_json: `{"action":"getDueReviews","params":{}}` },
    { pattern: "今天复习什么", intent: "query_due_reviews", params_json: "{}", operation_json: `{"action":"getDueReviews","params":{}}` },
    { pattern: "学习进度怎么样", intent: "query_study_stats", params_json: "{}", operation_json: `{"action":"getStudyStats","params":{}}` },
    { pattern: "我的掌握度怎么样", intent: "query_study_stats", params_json: "{}", operation_json: `{"action":"getStudyStats","params":{}}` },
    { pattern: "学习计划是什么", intent: "query_study_plan", params_json: "{}", operation_json: `{"action":"getStudyPlan","params":{}}` },
    { pattern: "我的学习计划", intent: "query_study_plan", params_json: "{}", operation_json: `{"action":"getStudyPlan","params":{}}` },
    { pattern: "有什么要复习的", intent: "query_due_reviews", params_json: "{}", operation_json: `{"action":"getDueReviews","params":{}}` },
    { pattern: "学习统计", intent: "query_study_stats", params_json: "{}", operation_json: `{"action":"getStudyStats","params":{}}` },
  ];
  for (const s of seedPatterns) {
    const norm = normalizePattern(s.pattern);
    if (!norm) continue;
    const exists = db.prepare(
      `SELECT id FROM sys_querycache WHERE user_id IS NULL AND pattern = ? LIMIT 1`,
    ).get(norm);
    if (!exists) {
      db.prepare(
        `INSERT INTO sys_querycache (user_id, pattern, intent, params_json, operation_json)
         VALUES (NULL, ?, ?, ?, ?)`,
      ).run(norm, s.intent, s.params_json, s.operation_json);
    }
  }
}
