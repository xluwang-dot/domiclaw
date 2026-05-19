import type { SessionData } from "express-session";
import session from "express-session";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { STORE_DIR } from "./config.js";

const { Store } = session;

class BetterSqlite3Store extends Store {
  private db: Database.Database;
  private getStmt: Database.Statement;
  private setStmt: Database.Statement;
  private delStmt: Database.Statement;
  private touchStmt: Database.Statement;

  constructor() {
    super();
    const dbPath = path.join(STORE_DIR, "sessions.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);

    try { this.db.exec("SELECT data FROM sessions LIMIT 1"); } catch { this.db.exec("DROP TABLE IF EXISTS sessions"); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.db.pragma("journal_mode = WAL");

    this.getStmt = this.db.prepare("SELECT data FROM sessions WHERE sid = ? AND expires_at > ?");
    this.setStmt = this.db.prepare("INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)");
    this.delStmt = this.db.prepare("DELETE FROM sessions WHERE sid = ?");
    this.touchStmt = this.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?");

    const cleanStmt = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?");
    setInterval(() => { cleanStmt.run(Date.now()); }, 900_000).unref();
  }

  get(sid: string, callback: (err?: unknown, session?: SessionData | null) => void): void {
    try {
      const row = this.getStmt.get(sid, Date.now()) as { data: string } | undefined;
      callback(null, row ? JSON.parse(row.data) as SessionData : null);
    } catch (err) { callback(err); }
  }

  set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 86400000;
      this.setStmt.run(sid, JSON.stringify(session), Date.now() + maxAge);
      callback?.();
    } catch (err) { callback?.(err); }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try { this.delStmt.run(sid); callback?.(); } catch (err) { callback?.(err); }
  }

  touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 86400000;
      this.touchStmt.run(Date.now() + maxAge, sid);
      callback?.();
    } catch (err) { callback?.(err); }
  }
}

export function createSessionStore(): session.Store {
  return new BetterSqlite3Store();
}
