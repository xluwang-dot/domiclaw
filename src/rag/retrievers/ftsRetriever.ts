import Database from "better-sqlite3";
import { Retriever, RetrieveResult } from "./base.js";

export class LikeRetriever implements Retriever {
  constructor(private db: Database.Database) {}

  retrieve(query: string, topK: number): Promise<RetrieveResult[]> {
    const like = `%${query}%`;
    const rows = this.db.prepare(
      `SELECT id, title, content FROM sys_knowledgepoints
       WHERE title LIKE ? OR content LIKE ? OR alias LIKE ?
       ORDER BY level_type, sort_order, title LIMIT ?`,
    ).all(like, like, like, topK) as { id: number; title: string; content: string | null }[];

    return Promise.resolve(
      rows.map((row, i) => ({
        id: row.id,
        title: row.title,
        content: row.content || "",
        score: 1 / (i + 1),
      })),
    );
  }
}
