import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  getPlanProgress,
  getPlanProgressByKp,
  upsertPlanProgress,
  getPlanProgressStats,
  completePlanProgress,
  resetPlanProgress,
  initPlanProgress,
  isPlanCompleted,
  getNextPendingKp,
  getAssessedKpCount,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";

let testDb: Database.Database;
const userId = 1;
const subjectId = 1;

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);
});

describe("plan_progress CRUD", () => {
  it("initPlanProgress should insert pending rows", () => {
    initPlanProgress(userId, subjectId, [10, 20, 30]);
    const rows = getPlanProgress(userId, subjectId);
    expect(rows).toHaveLength(3);
    expect(rows[0].status).toBe("pending");
  });

  it("upsertPlanProgress should update status and set assessed_at", () => {
    initPlanProgress(userId, subjectId, [10]);
    upsertPlanProgress(userId, subjectId, 10, "mastered");
    const row = getPlanProgressByKp(userId, subjectId, 10);
    expect(row).toBeDefined();
    expect(row!.status).toBe("mastered");
    expect(row!.assessed_at).toBeTruthy();
  });

  it("getPlanProgressStats should aggregate correctly", () => {
    initPlanProgress(userId, subjectId, [10, 20, 30, 40]);
    upsertPlanProgress(userId, subjectId, 10, "mastered");
    upsertPlanProgress(userId, subjectId, 20, "unsure");
    upsertPlanProgress(userId, subjectId, 30, "unknown");
    const stats = getPlanProgressStats(userId, subjectId);
    expect(stats.total).toBe(4);
    expect(stats.assessed).toBe(3);
    expect(stats.mastered).toBe(1);
    expect(stats.unsure).toBe(1);
    expect(stats.unknown).toBe(1);
  });

  it("completePlanProgress should set plan_completed", () => {
    initPlanProgress(userId, subjectId, [10]);
    completePlanProgress(userId, subjectId);
    expect(isPlanCompleted(userId, subjectId)).toBe(true);
  });

  it("resetPlanProgress should delete all rows", () => {
    initPlanProgress(userId, subjectId, [10, 20]);
    resetPlanProgress(userId, subjectId);
    const rows = getPlanProgress(userId, subjectId);
    expect(rows).toHaveLength(0);
  });

  it("getNextPendingKp should return first pending kp", () => {
    initPlanProgress(userId, subjectId, [10, 20, 30]);
    upsertPlanProgress(userId, subjectId, 10, "mastered");
    const next = getNextPendingKp(userId, subjectId);
    expect(next).toBeDefined();
    expect(next!.kp_id).toBe(20);
  });

  it("getNextPendingKp should return undefined when all assessed", () => {
    initPlanProgress(userId, subjectId, [10]);
    upsertPlanProgress(userId, subjectId, 10, "mastered");
    const next = getNextPendingKp(userId, subjectId);
    expect(next).toBeUndefined();
  });

  it("getAssessedKpCount should count non-pending rows", () => {
    initPlanProgress(userId, subjectId, [10, 20, 30]);
    upsertPlanProgress(userId, subjectId, 10, "mastered");
    upsertPlanProgress(userId, subjectId, 20, "unsure");
    expect(getAssessedKpCount(userId, subjectId)).toBe(2);
  });

  it("isPlanCompleted returns false when no plan_completed", () => {
    initPlanProgress(userId, subjectId, [10]);
    expect(isPlanCompleted(userId, subjectId)).toBe(false);
  });
});
