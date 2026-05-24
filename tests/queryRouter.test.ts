import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDatabase, insertTestUser, insertTestSubject, insertTestKnowledgePoint, insertTestQuestion } from "./setup.js";
import "../src/tools/quiz.js";
import { getTool, getAllToolDefinitions } from "../src/tools/index.js";
import { parseCardCommand } from "../src/query-router.js";

async function handleCardCommand(
  text: string, userId: number,
): Promise<string | null> {
  const parsed = parseCardCommand(text);
  if (!parsed) return null;

  const tool = getTool(parsed.toolName);
  if (!tool) {
    const names = getAllToolDefinitions().map(t => t.function.name).join(", ");
    return `Error: unknown tool "${parsed.toolName}". Available: ${names}`;
  }

  const result = await tool.execute(parsed.params, { workspaceDir: "/tmp/test", userId });
  return result;
}

describe("parseCardCommand", () => {
  it("should parse __CARD__:create_quiz with kp_id", () => {
    const r = parseCardCommand("__CARD__:create_quiz:kp_id=5");
    expect(r).not.toBeNull();
    expect(r!.toolName).toBe("create_quiz");
    expect(r!.params.kp_id).toBe(5);
  });

  it("should parse with multiple params", () => {
    const r = parseCardCommand("__CARD__:create_quiz:kp_id=5:subject=数学:kp_name=有理数");
    expect(r!.params.kp_id).toBe(5);
    expect(r!.params.subject).toBe("数学");
    expect(r!.params.kp_name).toBe("有理数");
  });

  it("should parse source=wrong param", () => {
    const r = parseCardCommand("__CARD__:create_quiz:kp_id=42:source=wrong");
    expect(r!.params.kp_id).toBe(42);
    expect(r!.params.source).toBe("wrong");
  });

  it("should parse number values", () => {
    const r = parseCardCommand("__CARD__:create_quiz:kp_id=10:question_count=3");
    expect(r!.params.kp_id).toBe(10);
    expect(r!.params.question_count).toBe(3);
  });

  it("should return null for non-__CARD__ text", () => {
    expect(parseCardCommand("hello")).toBeNull();
    expect(parseCardCommand("__CREATE_QUIZ__:{}")).toBeNull();
  });

  it("should return null for empty after __CARD__:", () => {
    expect(parseCardCommand("__CARD__:")).toBeNull();
  });

  it("should skip invalid key=value pairs", () => {
    const r = parseCardCommand("__CARD__:create_quiz:kp_id=5:badpair:ok=yes");
    expect(r!.params.kp_id).toBe(5);
    expect(r!.params.badpair).toBeUndefined();
    expect(r!.params.ok).toBe("yes");
  });

  it("should strip quotes from values", () => {
    const r = parseCardCommand('__CARD__:create_quiz:kp_name="有理数的分类"');
    expect(r!.params.kp_name).toBe("有理数的分类");
  });
});

describe("handleCardCommand", () => {
  let db: Database.Database;
  let userId: number;
  let subjectId: number;
  let kpId: number;

  beforeEach(() => {
    db = createTestDatabase();
    userId = insertTestUser(db);
    subjectId = insertTestSubject(db, "数学");
    kpId = insertTestKnowledgePoint(db, subjectId, "有理数", null);
    // Insert a question to populate the KP
    insertTestQuestion(db, "1+1=?", "2", kpId, 1);
  });

  afterEach(() => {
    db.close();
  });

  it("should execute create_quiz via __CARD__ command", async () => {
    const result = await handleCardCommand(
      `__CARD__:create_quiz:kp_id=${kpId}:subject=数学:kp_name=有理数`,
      userId,
    );
    expect(result).not.toBeNull();
    // create_quiz tool returns quiz info
    expect(result).toContain("Quiz");
    expect(result).toContain("数学");
  });

  it("should fail with unknown tool", async () => {
    const result = await handleCardCommand(
      "__CARD__:nonexistent_tool:kp_id=5",
      userId,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("unknown tool");
  });

  it("should handle create_quiz with no questions", async () => {
    // Use a KP with no questions
    const emptyKpId = insertTestKnowledgePoint(db, subjectId, "空章节", null);
    const result = await handleCardCommand(
      `__CARD__:create_quiz:kp_id=${emptyKpId}:subject=数学`,
      userId,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("No questions found");
  });

  it("should return null for non-card text", async () => {
    const result = await handleCardCommand("hello", userId);
    expect(result).toBeNull();
  });
});
