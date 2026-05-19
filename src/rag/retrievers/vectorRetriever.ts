import Database from "better-sqlite3";
import { Retriever, RetrieveResult } from "./base.js";
import {
  generateEmbedding,
  blobToFloat32,
  isEmbedderReady,
} from "../embeddings/embeddingService.js";

export class VectorRetriever implements Retriever {
  constructor(private db: Database.Database) {}

  async retrieve(query: string, topK: number): Promise<RetrieveResult[]> {
    if (!isEmbedderReady()) return [];

    const qVec = await generateEmbedding(query);

    const rows = this.db.prepare(
      `SELECT id, title, content, embedding FROM sys_knowledgepoints WHERE embedding IS NOT NULL`,
    ).all() as { id: number; title: string; content: string | null; embedding: Buffer }[];

    const scored = rows
      .map(row => {
        const dbVec = blobToFloat32(row.embedding);
        const dot = qVec.reduce((sum, v, i) => sum + v * dbVec[i], 0);
        return {
          id: row.id,
          title: row.title,
          content: row.content || "",
          score: dot,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }
}
