import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import Database from "better-sqlite3";
import {
  createSchema,
  useTestDatabase,
  addSubject,
  addKnowledgePoint,
  searchKnowledgePoints,
  generateKPEmbedding,
  rebuildAllEmbeddings,
} from "../src/db.js";
import { initAuthDb } from "../src/auth.js";
import { LikeRetriever } from "../src/rag/retrievers/ftsRetriever.js";
import { VectorRetriever } from "../src/rag/retrievers/vectorRetriever.js";
import { initRetriever, retrieveRelevant } from "../src/rag/index.js";

// ========== embeddingService ==========

describe("embeddingService", () => {
  it("float32ToBlob / blobToFloat32 round-trip", async () => {
    const { float32ToBlob, blobToFloat32 }
      = await import("../src/rag/embeddings/embeddingService.js");

    const original = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const blob = float32ToBlob(original);
    expect(blob).toBeInstanceOf(Buffer);
    expect(blob.length).toBe(original.length * 4);

    const restored = blobToFloat32(blob);
    expect(restored).toBeInstanceOf(Float32Array);
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 6);
    }
  });

  it("generateEmbedding should throw if model not initialized", async () => {
    const { generateEmbedding } = await import("../src/rag/embeddings/embeddingService.js");
    await expect(generateEmbedding("test")).rejects.toThrow("模型未初始化");
  });

  it("initEmbedder and generateEmbedding should work with real model", async () => {
    const { initEmbedder, generateEmbedding }
      = await import("../src/rag/embeddings/embeddingService.js");

    await initEmbedder();
    const vec = await generateEmbedding("有理数的加法法则");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBeGreaterThan(100);

    const vec2 = await generateEmbedding("有理数的加法法则");
    const dot = vec.reduce((sum, v, i) => sum + v * vec2[i], 0);
    expect(dot).toBeGreaterThan(0.999);
  }, 180000);

  it("similar texts should have higher cosine similarity than dissimilar ones", async () => {
    const { initEmbedder, generateEmbedding }
      = await import("../src/rag/embeddings/embeddingService.js");

    await initEmbedder();

    const sim1 = await generateEmbedding("有理数的加法");
    const sim2 = await generateEmbedding("有理数的减法");
    const diff = await generateEmbedding("秦朝统一六国");

    const dotSim = sim1.reduce((sum, v, i) => sum + v * sim2[i], 0);
    const dotDiff = sim1.reduce((sum, v, i) => sum + v * diff[i], 0);

    expect(dotSim).toBeGreaterThan(dotDiff);
  }, 180000);
});

// ========== LikeRetriever ==========

describe("LikeRetriever", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    initAuthDb(db);
    useTestDatabase(db);

    const subjId = addSubject("TestMath", null);
    addKnowledgePoint(subjId, "Quadratic Function", "ax²+bx+c");
    addKnowledgePoint(subjId, "Linear Equation", "ax+b=0");
    addKnowledgePoint(subjId, "Trigonometry", "sin, cos, tan");
  });

  it("should find matching KPs by keyword", async () => {
    const retriever = new LikeRetriever(db);
    const results = await retriever.retrieve("Quadratic", 10);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Quadratic Function");
  });

  it("should return empty for no match", async () => {
    const retriever = new LikeRetriever(db);
    const results = await retriever.retrieve("NonExistent", 10);
    expect(results.length).toBe(0);
  });

  it("should limit results by topK", async () => {
    const retriever = new LikeRetriever(db);
    const results = await retriever.retrieve("a", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results should have valid RetrieveResult shape", async () => {
    const retriever = new LikeRetriever(db);
    const results = await retriever.retrieve("Equation", 10);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("content");
      expect(r).toHaveProperty("score");
      expect(typeof r.score).toBe("number");
    }
  });
});

// ========== VectorRetriever (with real model) ==========

describe("VectorRetriever", () => {
  let db: Database.Database;

  beforeAll(async () => {
    const { initEmbedder } = await import("../src/rag/embeddings/embeddingService.js");
    await initEmbedder();
  }, 180000);

  beforeEach(async () => {
    db = new Database(":memory:");
    createSchema(db);
    initAuthDb(db);
    useTestDatabase(db);

    const subjId = addSubject("TestMath", null);
    addKnowledgePoint(subjId, "有理数的加法", "同号相加取同号，异号相加取绝对值大的符号");
    addKnowledgePoint(subjId, "有理数的减法", "减去一个数等于加上这个数的相反数");
    addKnowledgePoint(subjId, "秦朝历史", "秦始皇统一六国，建立中央集权制度");
    addKnowledgePoint(subjId, "勾股定理", "直角三角形两条直角边的平方和等于斜边的平方");

    await rebuildAllEmbeddings();
  });

  it("should find semantically similar KPs", async () => {
    const retriever = new VectorRetriever(db);
    const results = await retriever.retrieve("加法法则", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("有理数的加法");
  });

  it("should rank relevant results higher than irrelevant ones", async () => {
    const retriever = new VectorRetriever(db);
    const results = await retriever.retrieve("减法怎么算", 5);
    const subtractionIdx = results.findIndex(r => r.title === "有理数的减法");
    expect(subtractionIdx).toBeGreaterThanOrEqual(0);
    const historyIdx = results.findIndex(r => r.title === "秦朝历史");
    expect(subtractionIdx).toBeLessThan(historyIdx);
  });

  it("should limit results by topK", async () => {
    const retriever = new VectorRetriever(db);
    const results = await retriever.retrieve("数学", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results should have valid RetrieveResult shape", async () => {
    const retriever = new VectorRetriever(db);
    const results = await retriever.retrieve("加法", 5);
    for (const r of results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("content");
      expect(r).toHaveProperty("score");
      expect(typeof r.score).toBe("number");
    }
  });

  it("should return empty when no embeddings exist", async () => {
    const db2 = new Database(":memory:");
    createSchema(db2);
    useTestDatabase(db2);
    const subjId = addSubject("Test", null);
    addKnowledgePoint(subjId, "Test KP", "test content");

    const retriever = new VectorRetriever(db2);
    const results = await retriever.retrieve("test", 5);
    expect(results).toEqual([]);
  });
});

// ========== rag/index (initRetriever + retrieveRelevant) ==========

describe("rag index", () => {
  it("initRetriever with default config (VECTOR_SEARCH_ENABLED=false) should use LikeRetriever", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    initAuthDb(db);
    useTestDatabase(db);

    const subjId = addSubject("Test", null);
    addKnowledgePoint(subjId, "Hello World", "test content");

    initRetriever(db);
    const results = await retrieveRelevant("Hello");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("Hello World");
  });

  it("should filter results below MIN_RELEVANCE_SCORE", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    initAuthDb(db);
    useTestDatabase(db);
    const subjId = addSubject("Test", null);
    addKnowledgePoint(subjId, "UniqueMatchKP", "some content");

    initRetriever(db);
    const results = await retrieveRelevant("UniqueMatchKP");
    expect(results.length).toBeGreaterThan(0);
    const scores = results.map(r => r.score);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0.65);
  });
});

// ========== db.ts (generateKPEmbedding + rebuildAllEmbeddings) ==========

describe("generateKPEmbedding / rebuildAllEmbeddings", () => {
  let db: Database.Database;

  beforeAll(async () => {
    const { initEmbedder } = await import("../src/rag/embeddings/embeddingService.js");
    await initEmbedder();
  }, 180000);

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    initAuthDb(db);
    useTestDatabase(db);
  });

  it("generateKPEmbedding should generate and store embedding for a KP", async () => {
    const subjId = addSubject("Test", null);
    const kpId = addKnowledgePoint(subjId, "Test KP", "test content");

    const result = await generateKPEmbedding(kpId);
    expect(result).toBe(true);

    const row = db.prepare("SELECT embedding FROM sys_knowledgepoints WHERE id = ?").get(kpId) as { embedding: Buffer | null };
    expect(row.embedding).toBeTruthy();
    expect(row.embedding!.length).toBeGreaterThan(100);
  });

  it("generateKPEmbedding should return false for non-existent KP", async () => {
    const result = await generateKPEmbedding(99999);
    expect(result).toBe(false);
  });

  it("rebuildAllEmbeddings should generate embeddings for all KPs without them", async () => {
    const subjId = addSubject("Test", null);
    addKnowledgePoint(subjId, "KP1", "content1");
    addKnowledgePoint(subjId, "KP2", "content2");
    addKnowledgePoint(subjId, "KP3", "content3");

    const count = await rebuildAllEmbeddings();
    expect(count).toBe(3);

    const rows = db.prepare("SELECT id, embedding FROM sys_knowledgepoints").all() as { id: number; embedding: Buffer | null }[];
    for (const row of rows) {
      expect(row.embedding).toBeTruthy();
    }
  });

  it("rebuildAllEmbeddings should return 0 when all KPs already have embeddings", async () => {
    const subjId = addSubject("Test", null);
    addKnowledgePoint(subjId, "KP1", "content1");
    await rebuildAllEmbeddings();

    const count = await rebuildAllEmbeddings();
    expect(count).toBe(0);
  });

  it("LIKE search should still work unchanged", () => {
    const subjId = addSubject("Test", null);
    addKnowledgePoint(subjId, "UniqueKeywordABC", "test");
    const results = searchKnowledgePoints("UniqueKeywordABC");
    expect(results.length).toBe(1);
  });
});

// ========== buildSystemPrompt RAG injection ==========

describe("buildSystemPrompt RAG injection", () => {
  let db: Database.Database;

  beforeAll(async () => {
    const { initEmbedder } = await import("../src/rag/embeddings/embeddingService.js");
    await initEmbedder();
  }, 180000);

  beforeEach(async () => {
    db = new Database(":memory:");
    createSchema(db);
    initAuthDb(db);
    useTestDatabase(db);

    const subjId = addSubject("TestMath", null);
    addKnowledgePoint(subjId, "有理数的加法", "加法法则内容");
    await rebuildAllEmbeddings();

    initRetriever(db);
  });

  it("should inject retrieved knowledge into system prompt", async () => {
    const { buildSystemPrompt } = await import("../src/agent/environment.js");
    const { systemPrompt } = await buildSystemPrompt(0, "TestBot", "加法法则");
    expect(systemPrompt).toContain("[Retrieved Knowledge]");
    expect(systemPrompt).toContain("有理数的加法");
  });

  it("should not inject when no userInput is provided", async () => {
    const { buildSystemPrompt } = await import("../src/agent/environment.js");
    const { systemPrompt } = await buildSystemPrompt(0, "TestBot");
    expect(systemPrompt).not.toContain("[Retrieved Knowledge]");
  });

  it("should still include session context", async () => {
    const { buildSystemPrompt } = await import("../src/agent/environment.js");
    const { systemPrompt } = await buildSystemPrompt(0, "TestBot", "加法法则");
    expect(systemPrompt).toContain("TestBot");
  });

  it("should tell agent not to re-search when RAG has hits", async () => {
    const { buildSystemPrompt } = await import("../src/agent/environment.js");
    const { systemPrompt } = await buildSystemPrompt(0, "TestBot", "加法法则");
    expect(systemPrompt).toContain("可直接用于回答知识性问题");
  });
});

// ========== current_question injection ==========

describe("current_question injection", () => {
  beforeEach(async () => {
    const { clearCurrentQuestion } = await import("../src/agent/questionContext.js");
    clearCurrentQuestion(42);
  });

  it("should inject current question into system prompt when set", async () => {
    const { setCurrentQuestion } = await import("../src/agent/questionContext.js");
    const { buildSystemPrompt } = await import("../src/agent/environment.js");

    setCurrentQuestion(42, {
      questionId: 100,
      questionText: "已知二次函数经过点(1,0)和(3,0)，求解析式",
      progress: { currentSubIndex: 0, solvedSubIndices: [], userAnswers: {} },
    });

    const { systemPrompt } = await buildSystemPrompt(42, "TestBot");
    expect(systemPrompt).toContain("[Current Question]");
    expect(systemPrompt).toContain("已知二次函数经过点(1,0)和(3,0)，求解析式");
  });

  it("should not inject when no current question", async () => {
    const { buildSystemPrompt } = await import("../src/agent/environment.js");
    const { systemPrompt } = await buildSystemPrompt(42, "TestBot");
    expect(systemPrompt).not.toContain("[Current Question]");
  });

  it("should include sub-questions and progress when set", async () => {
    const { setCurrentQuestion } = await import("../src/agent/questionContext.js");
    const { buildSystemPrompt } = await import("../src/agent/environment.js");

    setCurrentQuestion(42, {
      questionId: 100,
      questionText: "已知二次函数...",
      subQuestions: ["(1) 求解析式", "(2) 求顶点坐标"],
      progress: { currentSubIndex: 1, solvedSubIndices: [0], userAnswers: { 0: "y=x²-4x+3" } },
    });

    const { systemPrompt } = await buildSystemPrompt(42, "TestBot");
    expect(systemPrompt).toContain("第1问");
    expect(systemPrompt).toContain("第 2 问");
  });
});
