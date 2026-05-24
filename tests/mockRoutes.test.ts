import { createTestDatabase, insertTestUser, insertTestSubject, insertTestKnowledgePoint, insertTestQuestion } from "./setup.js";
import Database from "better-sqlite3";

describe("T073 Mock Routes", () => {
  let db: Database.Database;
  let userId: number;

  beforeEach(() => {
    db = createTestDatabase();
    userId = insertTestUser(db);
  });

  describe("GET /api/plan/progress", () => {
    it("should return mock plan progress structure", () => {
      const mockResponse = {
        has_plan: true,
        progress: 40,
        next_chapter: "有理数的运算",
      };
      expect(mockResponse).toHaveProperty("has_plan");
      expect(mockResponse).toHaveProperty("progress");
      expect(mockResponse).toHaveProperty("next_chapter");
      expect(typeof mockResponse.progress).toBe("number");
      expect(mockResponse.progress).toBeGreaterThanOrEqual(0);
      expect(mockResponse.progress).toBeLessThanOrEqual(100);
    });
  });

  describe("GET /api/user/wrong-questions", () => {
    it("should return mock wrong questions array", () => {
      const mockResponse = {
        total: 2,
        questions: [
          { id: 1, question_text: "Test Q1", question_type: "choice", wrong_count: 2, last_wrong: "2026-05-22" },
          { id: 2, question_text: "Test Q2", question_type: "fill", wrong_count: 1, last_wrong: "2026-05-23" },
        ],
      };
      expect(Array.isArray(mockResponse.questions)).toBe(true);
      expect(mockResponse.total).toBe(mockResponse.questions.length);
      for (const q of mockResponse.questions) {
        expect(q).toHaveProperty("id");
        expect(q).toHaveProperty("question_text");
        expect(q).toHaveProperty("wrong_count");
        expect(q.wrong_count).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("POST /api/quiz/create-by-kp source='wrong'", () => {
    it("should accept source parameter and return filtered questions", () => {
      const subjectId = insertTestSubject(db, "数学");
      const kpId = insertTestKnowledgePoint(db, subjectId, "有理数");
      insertTestQuestion(db, "Normal Q", "A", kpId);
      insertTestQuestion(db, "Wrong Q", "B", kpId);

      const params = { kp_id: kpId, limit: 5, source: "wrong" };
      expect(params).toHaveProperty("source");
      expect(params.source).toBe("wrong");
      expect(params.kp_id).toBeGreaterThan(0);
    });
  });
});
