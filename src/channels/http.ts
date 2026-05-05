import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";

import { NewMessage } from "../types.js";
import { logger } from "../logger.js";
import { runAgent, AgentOutput } from "../agent.js";
import { handleCommand } from "../commands.js";
import { defaultLimiter } from "../rate-limit.js";
import { formatMessages } from "../router.js";
import {
  getAllSubjects,
  getKnowledgePointsBySubject,
  getSubjectByName,
  getQuestionsBySubject,
  getActiveQuizSession,
  getQuizSessionAnswers,
  getQuestionById,
  createQuizSession,
  recordQuizAnswer,
  recordWrongQuestion,
  getStudyStats,
  getWrongQuestionsBySubject,
  getDueReviews,
  upsertSessionContext,
  storeMessage,
  getMessagesSince,
  addSubject,
  updateSubject,
  deleteSubject,
  addKnowledgePoint,
  searchKnowledgePoints,
  validateKnowledgePointLevel,
  KnowledgePointRow,
  getAllKnowledgePoints,
  updateKnowledgePoint,
  deleteKnowledgePoint,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  addUserQuestion,
  getUserQuestions,
  updateUserQuestion,
  deleteUserQuestion,
  bulkImportUserQuestions,
  getUserKpMastery,
  getQuestionsForKpQuiz,
  updateQuestionExplanation,
  getKnowledgePointById,
  getQuestionsAdmin,
  toggleQuestionStatus,
  findDuplicateQuestions,
  bulkImportQuestionsAdmin,
  getUserProfile,
  deleteUserCascade,
} from "../db.js";
import {
  ASSISTANT_NAME,
  WEBCLIENT_PORT,
  MAX_MESSAGES_PER_PROMPT,
  SESSION_SECRET,
  MODEL_NAME,
  MODEL_BASE_URL,
  MODEL_API_KEY,
} from "../config.js";
import {
  createUser,
  getUserById,
  getUserByUsername,
  verifyPassword,
  updateActiveSession,
  clearActiveSession,
  getUserBySessionId,
  getAllUsers,
  searchUsers,
  resetUserPassword,
  hashPassword,
  UserRow,
} from "../auth.js";

// Extend express-session to include userId
declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

// ---------- SSE ----------

const sseClients = new Map<number, Set<http.ServerResponse>>();

function addSseClient(userId: number, res: http.ServerResponse): void {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId)!.add(res);
}

function removeSseClient(userId: number, res: http.ServerResponse): void {
  sseClients.get(userId)?.delete(res);
  if (sseClients.get(userId)?.size === 0) sseClients.delete(userId);
}

export function pushSse(userId: number, event: string, data: unknown): void {
  const clients = sseClients.get(userId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

// ---------- Graph data helpers ----------

interface GraphNode {
  id: string;
  type: "subject" | "knowledge_point" | "exam_paper" | "quiz_session";
  label: string;
  x: number;
  y: number;
  meta?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
}

function buildGraphData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const subjects = getAllSubjects();
  const allKps = getAllKnowledgePoints();

  // Group KPs by subject, then by parent_id
  const kpsBySubject: Record<number, KnowledgePointRow[]> = {};
  const kpsByParent: Record<number, KnowledgePointRow[]> = {};
  for (const kp of allKps) {
    if (!kpsBySubject[kp.subject_id]) kpsBySubject[kp.subject_id] = [];
    kpsBySubject[kp.subject_id].push(kp);
    const pid = kp.parent_id ?? 0;
    if (!kpsByParent[pid]) kpsByParent[pid] = [];
    kpsByParent[pid].push(kp);
  }

  // Layout constants
  const layerH = 70;  // vertical spacing between layers
  const nodeW = 130;  // horizontal spacing between nodes
  const startX = 200;
  const startY = 100;

  // Process each subject
  let subjectCol = 0;
  const subjectSpacingX = 400;

  for (const s of subjects) {
    const subjKps = kpsBySubject[s.id] || [];
    const roots = subjKps.filter((k) => k.level_type === "root" && !k.parent_id);

    if (roots.length === 0) {
      // Legacy: no tree structure — show flat nodes around subject
      const sx = startX + subjectCol * subjectSpacingX;
      const sy = startY;
      nodes.push({
        id: `subj-${s.id}`, type: "subject", label: s.name_cn || s.name,
        x: sx, y: sy,
        meta: { description: s.description },
      });
      const flatKps = subjKps.filter((k) => k.level_type !== "root");
      flatKps.forEach((kp, ki) => {
        const angle = (ki / Math.max(flatKps.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const radius = 160;
        nodes.push({
          id: `kp-${kp.id}`, type: "knowledge_point", label: kp.title,
          x: sx + Math.cos(angle) * radius,
          y: sy + Math.sin(angle) * radius + 50,
          meta: { subjectId: s.id, levelType: kp.level_type, tags: kp.tags },
        });
        edges.push({ id: `edge-kp-${kp.id}`, fromId: `subj-${s.id}`, toId: `kp-${kp.id}`, label: "包含" });
      });
      subjectCol++;
      continue;
    }

    // Tree layout: breadth-first per level
    const root = roots[0];
    const baseX = startX + subjectCol * subjectSpacingX;
    let maxWidth = 0;

    // Place root node
    nodes.push({
      id: `subj-${s.id}`, type: "subject", label: root.title,
      x: baseX, y: startY,
      meta: { description: s.description, name_en: s.name, name_cn: s.name_cn },
    });

    // Helper: place children recursively
    function placeChildren(parentId: number, parentX: number, parentY: number, layer: number): number {
      const children = kpsByParent[parentId] || [];
      if (children.length === 0) return parentX;

      const totalW = Math.max(children.length * nodeW, nodeW);
      const cx = parentX - totalW / 2 + nodeW / 2;
      let rightmost = parentX;

      children.forEach((child, ci) => {
        const nx = cx + ci * nodeW;
        const ny = parentY + layerH;
        const nodeType = child.level_type === "knowledge_point" ? "knowledge_point" : "knowledge_point";
        nodes.push({
          id: `kp-${child.id}`, type: nodeType, label: child.title,
          x: nx, y: ny,
          meta: { subjectId: s.id, levelType: child.level_type, tags: child.tags },
        });
        edges.push({
          id: `edge-${parentId}-${child.id}`,
          fromId: parentId === root.id ? `subj-${s.id}` : `kp-${parentId}`,
          toId: `kp-${child.id}`,
          label: "包含",
        });

        const childRight = placeChildren(child.id, nx, ny, layer + 1);
        if (childRight > rightmost) rightmost = childRight;
      });

      return Math.max(rightmost, parentX);
    }

    const rightEdge = placeChildren(root.id, baseX, startY + layerH, 1);
    const width = rightEdge - baseX;
    if (width > maxWidth) maxWidth = width;

    subjectCol++;
  }

  return { nodes, edges };
}

// ---------- Middleware ----------

const WEB_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../web",
);

function serveFile(filePath: string, contentType: string, res: Response): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.set("Content-Type", contentType);
    res.send(content);
  } catch {
    res.status(404).json({ error: "Not found" });
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found" });
    return;
  }
  (req as Request & { user: UserRow }).user = user;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user?: UserRow }).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// ---------- Web server ----------

export function startWebServer(onAgentProcessed?: (timestamp: string) => void): void {
  if (!WEBCLIENT_PORT || WEBCLIENT_PORT === 0) {
    logger.info("WEBCLIENT_PORT not set, skipping web server");
    return;
  }

  const app = express();

  // Session store
  const SqliteStore = connectSqlite3(session);
  const sessionStore = new SqliteStore({
    db: "store/sessions.db",
    dir: ".",
  }) as session.Store;

  app.use(express.json({ limit: "10mb" }));
  app.use(
    session({
      store: sessionStore,
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: "lax",
      },
    }),
  );

  // CORS for local dev
  app.use((_req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Credentials", "true");
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // ---------- Auth routes (no auth required) ----------

  app.post("/api/auth/register", (req: Request, res: Response) => {
    const { username, password } = req.body as Record<string, unknown>;
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: "Password must be at least 4 characters" });
      return;
    }

    const existing = getUserByUsername(username);
    if (existing) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    const userId = createUser(username, password, "student");
    req.session.userId = userId;
    updateActiveSession(userId, req.sessionID);

    logger.info({ userId, username }, "User registered");
    res.json({ id: userId, username, role: "student" });
  });

  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { username, password } = req.body as Record<string, unknown>;
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    // Single-session enforcement: destroy old session if exists
    if (user.active_session_id) {
      const oldSessionUser = getUserBySessionId(user.active_session_id);
      if (oldSessionUser && oldSessionUser.id === user.id) {
        sessionStore.destroy(user.active_session_id, (err) => {
          if (err) logger.warn({ err }, "Failed to destroy old session");
        });
      }
    }

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        logger.error({ err }, "Session regenerate failed");
        res.status(500).json({ error: "Login failed" });
        return;
      }

      req.session.userId = user.id;
      updateActiveSession(user.id, req.sessionID);

      logger.info({ userId: user.id, username: user.username }, "User logged in");
      res.json({ id: user.id, username: user.username, role: user.role });
    });
  });

  app.post("/api/auth/logout", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    clearActiveSession(userId);
    req.session.destroy((err) => {
      if (err) logger.warn({ err }, "Session destroy error");
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", requireAuth, (req: Request, res: Response) => {
    const user = getUserById(req.session.userId!);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({ id: user.id, username: user.username, role: user.role });
  });

  // ---------- API routes (auth required) ----------

  // GET /api/graph
  app.get("/api/graph", requireAuth, (_req: Request, res: Response) => {
    const graph = buildGraphData();
    res.json(graph);
  });

  // GET /api/stats
  app.get("/api/stats", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const subjectName = req.query.subject as string | undefined;
    let subjectId: number | undefined;
    if (subjectName) {
      const s = getSubjectByName(subjectName);
      if (s) subjectId = s.id;
    }
    const stats = getStudyStats(userId, subjectId);
    const wrong = getWrongQuestionsBySubject(userId, subjectId);
    const due = getDueReviews(userId, subjectId);
    res.json({ stats, wrong, due });
  });

  // GET /api/stream → SSE
  app.get("/api/stream", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("event: connected\ndata: {}\n\n");

    addSseClient(userId, res as unknown as http.ServerResponse);

    req.on("close", () => {
      removeSseClient(userId, res as unknown as http.ServerResponse);
    });

    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on("close", () => clearInterval(heartbeat));
  });

  // POST /api/message
  app.post("/api/message", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const text = ((req.body as Record<string, unknown>).text as string) || "";

    if (!text.trim()) {
      res.status(400).json({ error: "Empty message" });
      return;
    }

    const msg: NewMessage = {
      id: `web-${Date.now()}`,
      sender: "web-user",
      sender_name: "Student",
      content: text,
      timestamp: new Date().toISOString(),
      is_from_me: false,
    };

    storeMessage(msg, userId);

    if (!defaultLimiter.check(String(userId))) {
      pushSse(userId, "done", { status: "error", error: "Rate limited. Please slow down." });
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    // Command check
    const cmdResult = handleCommand(text, { userId });
    if (cmdResult !== null) {
      const botMsg: NewMessage = {
        id: `web-cmd-${Date.now()}`,
        sender: ASSISTANT_NAME,
        sender_name: ASSISTANT_NAME,
        content: cmdResult,
        timestamp: new Date().toISOString(),
        is_bot_message: true,
      };
      storeMessage(botMsg, userId);
      onAgentProcessed?.(msg.timestamp);
      pushSse(userId, "done", { status: "success", text: cmdResult });
      res.json({ status: "ok", command: true });
      return;
    }

    // Trigger agent
    pushSse(userId, "status", { phase: "processing" });

    const recentMsgs = getMessagesSince(
      userId,
      new Date(Date.now() - 60000).toISOString(),
      ASSISTANT_NAME,
      MAX_MESSAGES_PER_PROMPT,
    );

    const prompt =
      recentMsgs.length > 0
        ? formatMessages(recentMsgs)
        : formatMessages([msg]);

    runAgent(
      {
        prompt,
        assistantName: ASSISTANT_NAME,
        userId,
      },
      async (output: AgentOutput) => {
        if (output.isPartial) {
          if (output.thinking) pushSse(userId, "thinking", { text: output.thinking });
          if (output.result) pushSse(userId, "token", { text: output.result });
        } else if (output.status === "success" && output.result) {
          upsertSessionContext(userId, msg.content.substring(0, 120), null, null);

          const botMsg: NewMessage = {
            id: `web-bot-${Date.now()}`,
            sender: ASSISTANT_NAME,
            sender_name: ASSISTANT_NAME,
            content: output.result,
            timestamp: new Date().toISOString(),
            is_bot_message: true,
          };
          storeMessage(botMsg, userId);
          pushSse(userId, "done", { status: "success", text: output.result });
        } else if (!output.isPartial) {
          pushSse(userId, "done", { status: "error", error: output.error });
        }
      },
    ).then(() => {
      onAgentProcessed?.(msg.timestamp);
    }).catch((err) => {
      logger.error({ err }, "Agent background processing error");
      onAgentProcessed?.(msg.timestamp);
      pushSse(userId, "done", {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });

    res.status(202).json({ status: "processing" });
  });

  // POST /api/quiz/create
  app.post("/api/quiz/create", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const body = req.body as Record<string, unknown>;
    const subjectName = body.subject as string;
    const questionCount = (body.question_count as number) || 5;

    if (!subjectName) {
      res.status(400).json({ error: "subject required" });
      return;
    }

    const subject = getSubjectByName(subjectName);
    if (!subject) {
      res.status(404).json({ error: `Subject "${subjectName}" not found` });
      return;
    }

    const questions = getQuestionsBySubject(subject.id, 200);
    if (questions.length === 0) {
      res.status(404).json({ error: "No questions for this subject" });
      return;
    }

    const selected = questions
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(questionCount, questions.length));

    const sessionId = createQuizSession(subject.id, userId);

    res.json({
      session_id: sessionId,
      subject: subjectName,
      questions: selected.map((q) => ({
        id: q.id,
        text: q.question_text,
        type: q.question_type,
        options: q.options ? JSON.parse(q.options) : null,
      })),
    });
  });

  // POST /api/quiz/answer
  app.post("/api/quiz/answer", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const body = req.body as Record<string, unknown>;
    const sessionId = body.session_id as number;
    const questionId = body.question_id as number;
    const answer = (body.answer as string) || "";

    if (!sessionId || !questionId) {
      res.status(400).json({ error: "session_id and question_id required" });
      return;
    }

    const question = getQuestionById(questionId);
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }

    const sa = answer.trim().toLowerCase();
    const ca = question.answer.trim().toLowerCase();
    const correct =
      question.question_type === "multiple_choice"
        ? sa === ca
        : sa.includes(ca) || ca.includes(sa);

    let subjectId = 0;
    if (question.knowledge_point_id) {
      const kp = getKnowledgePointById(question.knowledge_point_id);
      if (kp) subjectId = kp.subject_id;
    }
    recordQuizAnswer(sessionId, subjectId, questionId, answer, correct);

    if (!correct) {
      recordWrongQuestion(questionId, userId, subjectId);
    }

    const answers = getQuizSessionAnswers(sessionId);

    res.json({
      correct,
      explanation: question.explanation,
      answered_count: answers.length,
    });
  });

  // GET /api/knowledge-points (public auth-required, for question bank selector)
  app.get("/api/knowledge-points", requireAuth, (req: Request, res: Response) => {
    const subjectId = req.query.subject_id ? parseInt(req.query.subject_id as string, 10) : undefined;
    if (subjectId) {
      res.json(getKnowledgePointsBySubject(subjectId));
    } else {
      res.json(getAllKnowledgePoints());
    }
  });

  // GET /api/subjects (public auth-required, for question bank selector)
  app.get("/api/subjects", requireAuth, (_req: Request, res: Response) => {
    res.json(getAllSubjects());
  });

  // POST /api/quiz/create-by-kp
  app.post("/api/quiz/create-by-kp", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const { kp_id, limit: qLimit, exclude_ids } = req.body as Record<string, unknown>;
    const kpId = kp_id as number;
    if (!kpId) {
      res.status(400).json({ error: "kp_id required" });
      return;
    }
    const questions = getQuestionsForKpQuiz(
      kpId, userId,
      (qLimit as number) || 5,
      exclude_ids as number[] | undefined,
    );
    const sessionId = createQuizSession(0, userId); // subject_id = 0 for KP quiz
    res.json({
      session_id: sessionId,
      kp_id: kpId,
      questions: questions.map((q) => ({
        id: q.id,
        text: q.question_text,
        type: q.question_type,
        options: q.options ? JSON.parse(q.options) : null,
        difficulty: q.difficulty,
      })),
    });
  });

  // GET /api/question/:id/explanation
  app.get("/api/question/:id/explanation", requireAuth, (req: Request, res: Response) => {
    const qId = parseInt(req.params.id as string, 10);
    const question = getQuestionById(qId);
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    // If explanation already cached, return it
    if (question.explanation) {
      res.json({ explanation: question.explanation, cached: true });
      return;
    }
    // Async: generate via LLM (respond immediately, background generation)
    res.json({ explanation: null, pending: true });
    // Trigger async generation — client will poll or retry
    generateExplanation(qId).catch((err) => logger.error({ err }, "Explanation generation failed"));
  });

  async function generateExplanation(qId: number): Promise<void> {
    const question = getQuestionById(qId);
    if (!question || question.explanation) return;
    const body = {
      model: MODEL_NAME,
      messages: [
        { role: "system", content: "You are a helpful educational assistant. Given a question and its answer, provide a clear, concise explanation in Chinese. Keep it under 300 characters." },
        { role: "user", content: `Question: ${question.question_text}\nAnswer: ${question.answer}` },
      ],
      stream: false,
    };
    const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MODEL_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const explanation = data.choices?.[0]?.message?.content;
    if (explanation) {
      updateQuestionExplanation(qId, explanation);
    }
  }

  // GET /api/user/kp-mastery
  app.get("/api/user/kp-mastery", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    res.json(getUserKpMastery(userId));
  });

  // ---------- User-private question APIs (auth required) ----------

  // GET /api/my/questions
  app.get("/api/my/questions", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const kpId = req.query.kp_id ? parseInt(req.query.kp_id as string, 10) : undefined;
    const type = req.query.type as string | undefined;
    const difficulty = req.query.difficulty ? parseInt(req.query.difficulty as string, 10) : undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const result = getUserQuestions(userId, { kpId, type, difficulty, page, limit });
    res.json(result);
  });

  // POST /api/my/questions
  app.post("/api/my/questions", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const body = req.body as Record<string, unknown>;
    if (!body.question_text || !body.answer) {
      res.status(400).json({ error: "question_text and answer are required" });
      return;
    }
    const id = addUserQuestion(
      userId,
      body.question_text as string,
      body.answer as string,
      (body.question_type as string) || "short_answer",
      body.explanation as string | undefined,
      (body.difficulty as number) || 1,
      body.options as string | undefined,
      body.knowledge_point_id as number | undefined,
      body.exam_paper_id as number | undefined,
    );
    res.json({ id });
  });

  // PUT /api/my/questions/:id
  app.put("/api/my/questions/:id", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const id = parseInt(req.params.id as string, 10);
    const ok = updateUserQuestion(id, userId, req.body as Record<string, unknown>);
    if (!ok) {
      res.status(404).json({ error: "Question not found or not owned by you" });
      return;
    }
    res.json({ ok: true });
  });

  // DELETE /api/my/questions/:id
  app.delete("/api/my/questions/:id", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const id = parseInt(req.params.id as string, 10);
    const ok = deleteUserQuestion(id, userId);
    if (!ok) {
      res.status(404).json({ error: "Question not found or not owned by you" });
      return;
    }
    res.json({ ok: true });
  });

  // POST /api/my/questions/import
  app.post("/api/my/questions/import", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const items = req.body as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Request body must be a non-empty JSON array" });
      return;
    }
    const { imported } = bulkImportUserQuestions(userId, items.map((q) => ({
      question_text: q.question_text as string,
      answer: q.answer as string,
      question_type: q.question_type as string | undefined,
      explanation: q.explanation as string | undefined,
      difficulty: q.difficulty as number | undefined,
      options: q.options as string | undefined,
      knowledge_point_id: q.knowledge_point_id as number | undefined,
      exam_paper_id: q.exam_paper_id as number | undefined,
    })));
    res.json({ imported });
  });

  // ---------- Admin APIs (auth + admin role required) ----------

  // Subjects CRUD
  app.get("/api/admin/subjects", requireAuth, requireAdmin, (_req: Request, res: Response) => {
    res.json(getAllSubjects());
  });

  app.post("/api/admin/subjects", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { name, name_cn, alias, description } = req.body as Record<string, unknown>;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name required" });
      return;
    }
    const id = addSubject(name, (description as string) || null, (name_cn as string) || null, (alias as string) || null);
    // Auto-create root knowledge point for this subject (skip if already exists)
    const existingRoot = searchKnowledgePoints(name, id);
    if (!existingRoot.find((k) => k.level_type === "root" && !k.parent_id)) {
      addKnowledgePoint(id, name, `${name} 学科根节点`, null, "root", 0, undefined);
    }
    res.json({ id, name });
  });

  app.put("/api/admin/subjects/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const { name, description } = req.body as Record<string, unknown>;
    const ok = updateSubject(id, name as string, description as string | null);
    if (!ok) {
      res.status(404).json({ error: "Subject not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.delete("/api/admin/subjects/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const ok = deleteSubject(id);
    if (!ok) {
      res.status(404).json({ error: "Subject not found" });
      return;
    }
    res.json({ ok: true });
  });

  // Knowledge points CRUD
  app.get("/api/admin/knowledge-points", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const subjectId = req.query.subject_id ? parseInt(req.query.subject_id as string, 10) : undefined;
    if (subjectId) {
      res.json(getKnowledgePointsBySubject(subjectId));
    } else {
      res.json(getAllKnowledgePoints());
    }
  });

  app.post("/api/admin/knowledge-points", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { subject_id, title, content, tags, parent_id, level_type, sort_order } = req.body as Record<string, unknown>;
    if (!subject_id || !title || !content) {
      res.status(400).json({ error: "subject_id, title, content required" });
      return;
    }
    const id = addKnowledgePoint(
      subject_id as number, title as string, content as string,
      (parent_id as number) || null, (level_type as string) || undefined,
      (sort_order as number) || undefined, tags as string | undefined,
    );
    res.json({ id, title });
  });

  // Math chapter → module mapping for flat format import
  const MATH_CHAPTER_TO_MODULE: Record<string, string> = {
    "有理数": "数与式", "有理数的运算": "数与式", "代数式": "数与式",
    "整式的加减": "数与式", "整式的乘法": "数与式", "因式分解": "数与式",
    "分式": "数与式", "二次根式": "数与式", "实数": "数与式",
    "一元一次方程": "方程与不等式", "二元一次方程组": "方程与不等式",
    "不等式与不等式组": "方程与不等式", "一元二次方程": "方程与不等式",
    "平面直角坐标系": "函数与图象", "函数": "函数与图象",
    "二次函数": "函数与图象", "反比例函数": "函数与图象",
    "相交线与平行线": "图形与几何", "三角形": "图形与几何",
    "全等三角形": "图形与几何", "轴对称": "图形与几何",
    "勾股定理": "图形与几何", "四边形": "图形与几何", "旋转": "图形与几何",
    "圆": "图形与几何", "相似": "图形与几何", "锐角三角函数": "图形与几何",
    "视图与投影": "图形与几何",
    "数据的收集、整理与描述": "统计与概率", "概率初步": "统计与概率",
  };

  function importKpPath(
    subjectId: number, path: string[], content: string,
    tags: string | undefined, levelTypes: string[] | undefined,
  ): { created: number; reused: number; error?: string } {
    const defaultLevels = ["root", "module", "chapter", "knowledge_point"];
    const levels = levelTypes || defaultLevels.slice(0, path.length);
    if (levels.length !== path.length) {
      return { created: 0, reused: 0, error: `level_types length (${levels.length}) must match path length (${path.length})` };
    }

    let parentId: number | null = null;
    let created = 0;
    let reused = 0;

    for (let depth = 0; depth < path.length; depth++) {
      const title = path[depth];
      const levelType = levels[depth];
      const parentLevel = depth === 0 ? null : levels[depth - 1];
      const validation = validateKnowledgePointLevel(parentLevel, levelType);
      if (!validation.ok) {
        return { created, reused, error: `at depth ${depth}: ${validation.error}` };
      }

      const existing = searchKnowledgePoints(title, subjectId);
      const existingUnderParent = existing.find(
        (kp) => kp.title === title && kp.parent_id === parentId,
      );

      if (existingUnderParent) {
        parentId = existingUnderParent.id;
        reused++;
      } else {
        const nodeId = addKnowledgePoint(
          subjectId, title, depth === path.length - 1 ? content : `${title} (auto-created)`,
          parentId, levelType, depth, tags,
        );
        parentId = nodeId;
        created++;
      }
    }
    return { created, reused };
  }

  // Batch import knowledge points
  app.post("/api/admin/knowledge-points/import", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { subject_id, items, format } = req.body as { subject_id: unknown; items: unknown; format?: string };
    if (!subject_id || typeof subject_id !== "number") {
      res.status(400).json({ error: "subject_id required (number)" });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items must be a non-empty array" });
      return;
    }

    const subjects = getAllSubjects();
    const subject = subjects.find((s) => s.id === subject_id);
    if (!subject) {
      res.status(404).json({ error: `Subject ${subject_id} not found` });
      return;
    }

    let created = 0;
    let reused = 0;
    const errors: string[] = [];

    // Auto-detect format from first item if not explicitly specified
    const firstItem = items[0] as Record<string, unknown>;
    const detectedFormat = format || (firstItem.chapter_cn && firstItem.content_name ? "flat" : "path");

    // Flat format: math-specific, chapter_cn + content_name → auto-expand to 4-level path
    if (detectedFormat === "flat") {
      if (subject.name !== "Mathematics") {
        res.status(400).json({ error: "flat format is only supported for Mathematics" });
        return;
      }
      const subjectName = subject.name_cn || subject.name;

      for (let i = 0; i < items.length; i++) {
        const item = items[i] as Record<string, unknown>;
        const chapterCn = (item.chapter_cn as string) || "";
        const chapterEn = item.chapter_en as string | undefined;
        const contentName = (item.content_name as string) || "";
        const content = (item.content as string) || "";
        const tags = item.tags as string | undefined;

        if (!chapterCn || !contentName) {
          errors.push(`Item ${i}: chapter_cn and content_name required`);
          continue;
        }

        const module = MATH_CHAPTER_TO_MODULE[chapterCn];
        if (!module) {
          errors.push(`Item ${i}: 章节"${chapterCn}"不在数学章节映射表中，请检查或使用 path 格式`);
          continue;
        }

        const path = [subjectName, module, chapterCn, contentName];
        if (path.length > 4) {
          errors.push(`Item ${i}: path too deep (${path.length})`);
          continue;
        }

        // Build chapter tags with en name
        const chapterTags = chapterEn ? JSON.stringify({ en: chapterEn }) : undefined;

        const result = importKpPath(subject_id, path, content, tags, ["root", "module", "chapter", "knowledge_point"]);
        if (result.error) {
          errors.push(`Item ${i} ["${path.join('","')}"] ${result.error}`);
        }
        created += result.created;
        reused += result.reused;

        // If chapter node was created and has en tag, update it
        if (chapterEn) {
          const chapterNodes = searchKnowledgePoints(chapterCn, subject_id);
          const chapterNode = chapterNodes.find((k) => k.title === chapterCn && k.level_type === "chapter");
          if (chapterNode) {
            const existingTags = chapterNode.tags ? JSON.parse(chapterNode.tags) : {};
            existingTags.en = chapterEn;
            updateKnowledgePoint(chapterNode.id, undefined, undefined, JSON.stringify(existingTags));
          }
        }
      }
    } else {
      // Path format (default): explicit path array
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as Record<string, unknown>;
        const path = item.path as string[];
        const content = (item.content as string) || "";
        const tags = item.tags as string | undefined;
        const levelTypes = item.level_types as string[] | undefined;

        if (!Array.isArray(path) || path.length === 0 || path.length > 4) {
          errors.push(`Item ${i}: path must be 1-4 elements, got ${path?.length || 0}`);
          continue;
        }

        const result = importKpPath(subject_id, path, content, tags, levelTypes);
        if (result.error) {
          errors.push(`Item ${i} ["${path.join('","')}"] ${result.error}`);
        }
        created += result.created;
        reused += result.reused;
      }
    }

    res.json({
      created,
      reused,
      total: items.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  app.put("/api/admin/knowledge-points/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const { title, content, tags } = req.body as Record<string, unknown>;
    const ok = updateKnowledgePoint(id, title as string, content as string, tags as string | null);
    if (!ok) {
      res.status(404).json({ error: "Knowledge point not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.delete("/api/admin/knowledge-points/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const ok = deleteKnowledgePoint(id);
    if (!ok) {
      res.status(404).json({ error: "Knowledge point not found" });
      return;
    }
    res.json({ ok: true });
  });

  // Questions admin
  app.post("/api/admin/questions", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const q = req.body as Record<string, unknown>;
    const id = addQuestion(
      (q.exam_paper_id as number) || null,
      (q.knowledge_point_id as number) || null,
      q.question_text as string,
      q.answer as string,
      (q.question_type as string) || "short_answer",
      q.explanation as string | undefined,
      (q.difficulty as number) || 1,
      q.options as string | undefined,
    );
    res.json({ id });
  });

  app.put("/api/admin/questions/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const ok = updateQuestion(id, req.body as Record<string, unknown>);
    if (!ok) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.delete("/api/admin/questions/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const ok = deleteQuestion(id);
    if (!ok) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json({ ok: true });
  });

  // Users overview (with pagination and search)
  app.get("/api/admin/users", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const search = req.query.search as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const result = searchUsers(search, page, limit);
    res.json({
      users: result.users.map((u) => ({
        id: u.id, username: u.username, role: u.role,
        created_at: u.created_at, last_active: u.last_active,
        quiz_count: u.quiz_count, total_answers: u.total_answers,
        correct_answers: u.correct_answers,
        accuracy: u.total_answers > 0 ? Math.round((u.correct_answers / u.total_answers) * 100) : 0,
        active_wrong: u.active_wrong,
      })),
      total: result.total,
    });
  });

  app.get("/api/admin/users/:id/profile", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    res.json(getUserProfile(id));
  });

  app.post("/api/admin/users/:id/reset-password", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const { password } = req.body as Record<string, unknown>;
    if (!password || typeof password !== "string" || password.length < 4) {
      res.status(400).json({ error: "Password must be at least 4 characters" });
      return;
    }
    const ok = resetUserPassword(id, hashPassword(password));
    if (!ok) res.status(404).json({ error: "User not found" });
    else res.json({ ok: true });
  });

  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (id === req.session.userId) {
      res.status(400).json({ error: "Cannot delete yourself" });
      return;
    }
    deleteUserCascade(id);
    res.json({ ok: true });
  });

  // Questions admin (enhanced: with filters and pagination)
  app.get("/api/admin/questions", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const subjectId = req.query.subject_id ? parseInt(req.query.subject_id as string, 10) : undefined;
    const kpId = req.query.kp_id ? parseInt(req.query.kp_id as string, 10) : undefined;
    const status = req.query.status as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    res.json(getQuestionsAdmin({ subjectId, kpId, status, page, limit }));
  });

  app.post("/api/admin/questions/:id/toggle-status", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const next = toggleQuestionStatus(id);
    if (!next) res.status(404).json({ error: "Question not found" });
    else res.json({ status: next });
  });

  app.post("/api/admin/questions/import", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const items = req.body as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Request body must be a non-empty JSON array" });
      return;
    }
    res.json(bulkImportQuestionsAdmin(items.map((q) => ({
      question_text: q.question_text as string,
      answer: q.answer as string,
      question_type: q.question_type as string | undefined,
      explanation: q.explanation as string | undefined,
      difficulty: q.difficulty as number | undefined,
      options: q.options as string | undefined,
      knowledge_point_id: q.knowledge_point_id as number | undefined,
      exam_paper_id: q.exam_paper_id as number | undefined,
      status: q.status as string | undefined,
    }))));
  });

  app.get("/api/admin/questions/dedup", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const text = req.query.text as string;
    if (!text) { res.json([]); return; }
    res.json(findDuplicateQuestions(text));
  });

  // ---------- File serving ----------

  app.get("/login.html", (_req: Request, res: Response) => {
    serveFile(path.join(WEB_DIR, "login.html"), "text/html; charset=utf-8", res);
  });

  app.get("/app.html", requireAuth, (_req: Request, res: Response) => {
    serveFile(path.join(WEB_DIR, "app.html"), "text/html; charset=utf-8", res);
  });

  app.get("/admin.html", requireAuth, requireAdmin, (_req: Request, res: Response) => {
    serveFile(path.join(WEB_DIR, "admin.html"), "text/html; charset=utf-8", res);
  });

  // GET / → redirect based on auth and role
  app.get("/", (req: Request, res: Response) => {
    const userId = req.session.userId;
    if (!userId) {
      res.redirect("/login.html");
      return;
    }
    const user = getUserById(userId);
    if (!user) {
      res.redirect("/login.html");
      return;
    }
    if (user.role === "admin") {
      res.redirect("/admin.html");
    } else {
      res.redirect("/app.html");
    }
  });

  // ---------- Start server ----------

  const server = app.listen(WEBCLIENT_PORT, () => {
    logger.info({ port: WEBCLIENT_PORT }, "Web server listening (Express)");
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down...");
    for (const [, clients] of sseClients) {
      for (const res of clients) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    sseClients.clear();
    server.close(() => process.exit(0));
    // Force exit after 2s if server.close() hangs on keep-alive connections
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
