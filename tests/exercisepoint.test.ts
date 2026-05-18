import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  addSubject,
  addKnowledgePoint,
  getKnowledgePointById,
  searchKnowledgePoints,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";

let testDb: Database.Database;
let subjId: number;

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
  initAuthDb(testDb);
  useTestDatabase(testDb);
  subjId = addSubject("TestEP", null);
});

describe("knowledge_points — exercise_point_names field", () => {
  it("should have exercise_point_names column with NULL default", () => {
    const kpId = addKnowledgePoint(subjId, "Test KP", "content");

    const row = testDb.prepare(
      "SELECT exercise_point_names FROM sys_knowledgepoints WHERE id = ?"
    ).get(kpId) as { exercise_point_names: string | null };

    expect(row.exercise_point_names).toBeNull();
  });

  it("should store and retrieve exercise_point_names JSON array", () => {
    const kpId = addKnowledgePoint(subjId, "Test KP", "content");

    testDb.prepare(
      "UPDATE sys_knowledgepoints SET exercise_point_names = ? WHERE id = ?"
    ).run('["概念辨析", "计算应用"]', kpId);

    const kp = getKnowledgePointById(kpId);
    expect(kp).toBeDefined();
    expect(kp!.exercise_point_names).toBe('["概念辨析", "计算应用"]');
  });

  it("should handle empty array", () => {
    const kpId = addKnowledgePoint(subjId, "Test KP", "content");

    testDb.prepare(
      "UPDATE sys_knowledgepoints SET exercise_point_names = ? WHERE id = ?"
    ).run('[]', kpId);

    const kp = getKnowledgePointById(kpId);
    expect(kp!.exercise_point_names).toBe('[]');
  });

  it("should be returned by searchKnowledgePoints", () => {
    const kpId = addKnowledgePoint(subjId, "Search KP", "content");
    testDb.prepare(
      "UPDATE sys_knowledgepoints SET exercise_point_names = ? WHERE id = ?"
    ).run('["计算"]', kpId);

    const results = searchKnowledgePoints("Search KP");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].exercise_point_names).toBe('["计算"]');
  });
});
