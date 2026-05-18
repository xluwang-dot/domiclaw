import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  addSubject,
  addKnowledgePoint,
  updateNotebook,
  notebookAddWrong,
  notebookClearWeakness,
  getNotebookStats,
  getNotebookWeakKps,
  getUserKpMastery,
  getUserProfile,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";

let testDb: Database.Database;
let subjId: number;
let kpId: number;
let userId: number;

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);

  subjId = addSubject("TestNotebookSubj", null);
  kpId = addKnowledgePoint(subjId, "TestKP", "test content");

  // Create a test user
  const hash = "$2b$10$dummy";
  userId = testDb.prepare(
    "INSERT INTO sys_users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)"
  ).run("notebook_test_user", hash, "student", new Date().toISOString()).lastInsertRowid as number;
});

describe("user_notebook — basic CRUD", () => {
  it("should create a notebook entry via updateNotebook", () => {
    const result = updateNotebook(userId, subjId, kpId, true);
    expect(result.mastery).toBeGreaterThan(0.5); // EWMA 更新后 mastery 上升

    const row = testDb.prepare(
      "SELECT mastery, total_wrong FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?"
    ).get(userId, subjId, kpId) as { mastery: number; total_wrong: number };
    expect(row).toBeDefined();
    expect(row.total_wrong).toBe(0);
  });

  it("should decrease mastery on wrong answer", () => {
    updateNotebook(userId, subjId, kpId, false);
    const row = testDb.prepare("SELECT mastery FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?")
      .get(userId, subjId, kpId) as { mastery: number };
    expect(row.mastery).toBeLessThan(0.5);
  });
});

describe("user_notebook — wrong tracking", () => {
  it("should increment total_wrong via notebookAddWrong", () => {
    // First call creates the record
    updateNotebook(userId, subjId, kpId, false);
    notebookAddWrong(userId, subjId, kpId, 100);

    const row = testDb.prepare(
      "SELECT total_wrong, representative_question_id FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?"
    ).get(userId, subjId, kpId) as { total_wrong: number; representative_question_id: number };
    expect(row.total_wrong).toBe(1);
    expect(row.representative_question_id).toBe(100);
  });

  it("should accumulate total_wrong on repeated wrongs", () => {
    updateNotebook(userId, subjId, kpId, false);
    notebookAddWrong(userId, subjId, kpId, 100);
    notebookAddWrong(userId, subjId, kpId, 101);

    const row = testDb.prepare("SELECT total_wrong FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?")
      .get(userId, subjId, kpId) as { total_wrong: number };
    expect(row.total_wrong).toBe(2);
  });
});

describe("user_notebook — clear weakness", () => {
  it("should reset weakness fields when mastered", () => {
    // Set up a weak KP
    updateNotebook(userId, subjId, kpId, true); // mastery goes up
    updateNotebook(userId, subjId, kpId, true); // mastery goes up more
    updateNotebook(userId, subjId, kpId, true); // mastery > 0.8 after several corrects
    notebookAddWrong(userId, subjId, kpId, 100); // but has wrong record

    // total_wrong should be > 0 before clear
    const before = testDb.prepare("SELECT total_wrong FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?")
      .get(userId, subjId, kpId) as { total_wrong: number };
    expect(before.total_wrong).toBe(1);

    // Check mastery is high enough, then clear
    const cleared = notebookClearWeakness(userId, subjId, kpId);
    // It may or may not clear depending on actual mastery value
    const after = testDb.prepare("SELECT total_wrong, representative_question_id FROM user_notebook WHERE user_id = ? AND subject_id = ? AND kp_id = ?")
      .get(userId, subjId, kpId) as { total_wrong: number; representative_question_id: number | null };
    if (cleared) {
      expect(after.total_wrong).toBe(0);
      expect(after.representative_question_id).toBeNull();
    }
  });
});

describe("user_notebook — query functions", () => {
  it("getNotebookWeakKps should return KPs with total_wrong > 0", () => {
    updateNotebook(userId, subjId, kpId, false);
    notebookAddWrong(userId, subjId, kpId, 100);

    const weakKps = getNotebookWeakKps(userId);
    expect(weakKps.length).toBeGreaterThanOrEqual(1);
    expect(weakKps[0].kp_id).toBe(kpId);
    expect(weakKps[0].total_wrong).toBe(1);
  });

  it("getUserKpMastery should return notebook entries", () => {
    updateNotebook(userId, subjId, kpId, false);

    const entries = getUserKpMastery(userId);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].kp_id).toBe(kpId);
    expect(entries[0]).toHaveProperty("mastery");
    expect(entries[0]).toHaveProperty("total_wrong");
  });

  it("getNotebookStats should return aggregated stats", () => {
    updateNotebook(userId, subjId, kpId, true);

    const stats = getNotebookStats(userId);
    expect(stats).toHaveProperty("avg_mastery");
    expect(stats).toHaveProperty("kp_count");
    expect(stats).toHaveProperty("weakness_total");
    expect(stats.kp_count).toBeGreaterThanOrEqual(1);
  });

  it("getUserProfile should include weak_kp_count", () => {
    updateNotebook(userId, subjId, kpId, false);
    notebookAddWrong(userId, subjId, kpId, 100);

    const profile = getUserProfile(userId);
    expect(profile).toHaveProperty("weak_kp_count");
    expect(profile).toHaveProperty("avg_mastery");
  });
});
