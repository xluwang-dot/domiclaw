import Database from "better-sqlite3";
import { ragConfig } from "../config.js";
import { logger } from "../logger.js";
import { Retriever, RetrieveResult } from "./retrievers/base.js";
import { LikeRetriever } from "./retrievers/ftsRetriever.js";
import { VectorRetriever } from "./retrievers/vectorRetriever.js";
import { initEmbedder } from "./embeddings/embeddingService.js";

let retriever: Retriever | null = null;

export function initRetriever(db: Database.Database): void {
  if (ragConfig.vectorSearchEnabled) {
    retriever = new VectorRetriever(db);
    initEmbedder().catch(err =>
      logger.error({ err }, "Embedding model init failed, falling back to LIKE"),
    );
    logger.info("Vector retriever initialized");
  } else {
    retriever = new LikeRetriever(db);
    logger.info("LIKE retriever initialized");
  }
}

const MIN_RELEVANCE_SCORE = 0.65;

function filterRelevantResults(results: RetrieveResult[]): RetrieveResult[] {
  return results.filter(r => r.score >= MIN_RELEVANCE_SCORE);
}

export async function retrieveRelevant(query: string): Promise<RetrieveResult[]> {
  if (!retriever) return [];
  const engine = ragConfig.vectorSearchEnabled ? "Vector" : "LIKE";
  logger.info({ query, engine }, "[RAG] 开始检索");
  try {
    const results = await retriever.retrieve(query, ragConfig.topK);
    const filtered = filterRelevantResults(results);
    if (filtered.length > 0) {
      const hits = filtered.map(r => ({ title: r.title, score: r.score.toFixed(4) }));
      logger.info({ hits, engine }, `[RAG] 命中 ${filtered.length} 条知识点`);
    } else if (results.length > 0) {
      logger.info({ maxScore: Math.max(...results.map(r => r.score)).toFixed(4), engine }, "[RAG] 所有结果低于阈值，回退为纯 LLM 模式");
    } else {
      logger.info({ engine }, "[RAG] 无匹配知识点");
    }
    return filtered;
  } catch (err) {
    logger.error({ err, query }, "[RAG] 检索失败");
    return [];
  }
}
