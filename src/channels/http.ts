import http from "http";
import fs from "fs";
import path from "path";
import { Channel, NewMessage, RegisteredGroup } from "../types.js";
import type { ChannelOpts } from "./index.js";
import { logger } from "../logger.js";
import { runAgent } from "../agent.js";
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
  addExamPaper,
  addQuestion,
  setRegisteredGroup,
  upsertSessionContext,
} from "../db.js";
import {
  ASSISTANT_NAME,
  DEFAULT_TRIGGER,
  WEBCLIENT_PORT,
  MAX_MESSAGES_PER_PROMPT,
} from "../config.js";

// SSE client tracking: jid → Set of Response objects
const sseClients = new Map<string, Set<http.ServerResponse>>();

function addSseClient(jid: string, res: http.ServerResponse): void {
  if (!sseClients.has(jid)) sseClients.set(jid, new Set());
  sseClients.get(jid)!.add(res);
}

function removeSseClient(jid: string, res: http.ServerResponse): void {
  sseClients.get(jid)?.delete(res);
  if (sseClients.get(jid)?.size === 0) sseClients.delete(jid);
}

function pushSse(jid: string, event: string, data: unknown): void {
  const clients = sseClients.get(jid);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function pushSseToAll(event: string, data: unknown): void {
  for (const [, clients] of sseClients) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
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
  const cols = 3;
  subjects.forEach((s, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    nodes.push({
      id: `subj-${s.id}`,
      type: "subject",
      label: s.name,
      x: 200 + col * 300,
      y: 150 + row * 200,
      meta: { description: s.description },
    });
  });

  let kpCounter = 0;
  for (const s of subjects) {
    const kps = getKnowledgePointsBySubject(s.id);
    kps.forEach((kp, ki) => {
      const kpId = `kp-${kp.id}`;
      const subjectNode = nodes.find((n) => n.id === `subj-${s.id}`);
      const sx = subjectNode?.x ?? 200;
      const sy = subjectNode?.y ?? 150;
      const angle = (ki / Math.max(kps.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = 180;
      nodes.push({
        id: kpId,
        type: "knowledge_point",
        label: kp.title,
        x: sx + Math.cos(angle) * radius,
        y: sy + Math.sin(angle) * radius + 60,
        meta: { subjectId: s.id, tags: kp.tags },
      });
      edges.push({
        id: `edge-kp-${kp.id}`,
        fromId: `subj-${s.id}`,
        toId: kpId,
        label: "contains",
      });
      kpCounter++;
    });
  }

  return { nodes, edges };
}

// ---------- Routing ----------

const WEB_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../web",
);

function serveFile(
  filePath: string,
  contentType: string,
  res: http.ServerResponse,
): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function getQueryParam(
  req: http.IncomingMessage,
  key: string,
): string | undefined {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  return url.searchParams.get(key) || undefined;
}

// ---------- Channel factory ----------

export function WebChannel(opts: ChannelOpts): Channel | null {
  if (!WEBCLIENT_PORT || WEBCLIENT_PORT === 0) return null;

  const onMessageCb = opts.onMessage;
  const onChatMetadataCb = opts.onChatMetadata;
  const registeredGroups = opts.registeredGroups;
  const onAgentProcessed = opts.onAgentProcessed;

  const webJid = "web:console";

  let server: http.Server;

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const pathname = url.pathname;

    // GET / → serve web UI
    if (req.method === "GET" && pathname === "/") {
      serveFile(path.join(WEB_DIR, "index.html"), "text/html; charset=utf-8", res);
      return;
    }

    // GET /api/graph → knowledge graph data
    if (req.method === "GET" && pathname === "/api/graph") {
      const graph = buildGraphData();
      jsonResponse(res, 200, graph);
      return;
    }

    // GET /api/stats → study statistics
    if (req.method === "GET" && pathname === "/api/stats") {
      const jid = getQueryParam(req, "jid") || webJid;
      const subjectName = getQueryParam(req, "subject");
      let subjectId: number | undefined;
      if (subjectName) {
        const s = getSubjectByName(subjectName);
        if (s) subjectId = s.id;
      }
      const stats = getStudyStats(jid, subjectId);
      const wrong = getWrongQuestionsBySubject(jid, subjectId);
      const due = getDueReviews(jid, subjectId);
      jsonResponse(res, 200, { stats, wrong, due });
      return;
    }

    // GET /api/stream → SSE
    if (req.method === "GET" && pathname === "/api/stream") {
      const jid = getQueryParam(req, "jid") || webJid;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("event: connected\ndata: {}\n\n");

      addSseClient(jid, res);

      req.on("close", () => {
        removeSseClient(jid, res);
      });

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      req.on("close", () => clearInterval(heartbeat));
      return;
    }

    // POST /api/message → send message, trigger agent
    if (req.method === "POST" && pathname === "/api/message") {
      const body = await parseBody(req);
      const jid = webJid;
      const text = (body.text as string) || "";

      if (!text.trim()) {
        jsonResponse(res, 400, { error: "Empty message" });
        return;
      }

      const msg: NewMessage = {
        id: `web-${Date.now()}`,
        chat_jid: jid,
        sender: "web-user",
        sender_name: "Student",
        content: text,
        timestamp: new Date().toISOString(),
        is_from_me: false,
      };

      // Store message
      onMessageCb(jid, msg);
      onChatMetadataCb(jid, msg.timestamp, "Web Console", "web", false);

      // Ensure group exists
      const groups = registeredGroups();
      if (!groups[jid]) {
        // Auto-register web group — handled by the caller
        logger.warn("Web group not registered, message stored but not processed");
        jsonResponse(res, 202, { status: "stored", note: "group not registered" });
        return;
      }

      const group = groups[jid];

      // Rate limit check
      if (!defaultLimiter.check(jid)) {
        pushSse(jid, "done", { status: "error", error: "Rate limited. Please slow down." });
        jsonResponse(res, 429, { error: "Too many requests" });
        return;
      }

      // Command check (process locally, no API call)
      const cmdResult = handleCommand(text, {
        chatJid: jid,
        groupFolder: group.folder,
      });
      if (cmdResult !== null) {
        const botMsg: NewMessage = {
          id: `web-cmd-${Date.now()}`,
          chat_jid: jid,
          sender: ASSISTANT_NAME,
          sender_name: ASSISTANT_NAME,
          content: cmdResult,
          timestamp: new Date().toISOString(),
          is_bot_message: true,
        };
        onMessageCb(jid, botMsg);
        onAgentProcessed?.(jid, msg.timestamp);
        pushSse(jid, "done", { status: "success", text: cmdResult });
        jsonResponse(res, 200, { status: "ok", command: true });
        return;
      }

      // Trigger agent processing
      pushSse(jid, "status", { phase: "processing" });

      // Get recent messages for context
      const { getMessagesSince } = await import("../db.js");
      const recentMsgs = getMessagesSince(
        jid,
        new Date(Date.now() - 60000).toISOString(), // last minute
        ASSISTANT_NAME,
        MAX_MESSAGES_PER_PROMPT,
      );

      const prompt =
        recentMsgs.length > 0
          ? formatMessages(recentMsgs)
          : formatMessages([msg]);

      // Run agent in background
      runAgent(
        group,
        {
          prompt,
          groupFolder: group.folder,
          chatJid: jid,
          isMain: group.isMain === true,
          assistantName: ASSISTANT_NAME,
        },
        async (output) => {
          if (output.isPartial) {
            // Streaming chunk — push via SSE
            if (output.thinking) pushSse(jid, "thinking", { text: output.thinking });
            if (output.result) pushSse(jid, "token", { text: output.result });
          } else if (output.status === "success" && output.result) {
            // Update session context with the user's topic
            upsertSessionContext(jid, msg.content.substring(0, 120), null, null);

            const botMsg: NewMessage = {
              id: `web-bot-${Date.now()}`,
              chat_jid: jid,
              sender: ASSISTANT_NAME,
              sender_name: ASSISTANT_NAME,
              content: output.result,
              timestamp: new Date().toISOString(),
              is_bot_message: true,
            };
            onMessageCb(jid, botMsg);
            pushSse(jid, "done", { status: "success", text: output.result });
          } else if (!output.isPartial) {
            pushSse(jid, "done", { status: "error", error: output.error });
          }
        },
      ).then(() => {
        // Update cursor regardless of outcome
        onAgentProcessed?.(jid, msg.timestamp);
      }).catch((err) => {
        logger.error({ err }, "Agent background processing error");
        onAgentProcessed?.(jid, msg.timestamp);
        pushSse(jid, "done", {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });

      jsonResponse(res, 202, { status: "processing" });
      return;
    }

    // POST /api/quiz/create → create quiz
    if (req.method === "POST" && pathname === "/api/quiz/create") {
      const body = await parseBody(req);
      const jid = (body.jid as string) || webJid;
      const subjectName = body.subject as string;
      const questionCount = (body.question_count as number) || 5;

      if (!subjectName) {
        jsonResponse(res, 400, { error: "subject required" });
        return;
      }

      const subject = getSubjectByName(subjectName);
      if (!subject) {
        jsonResponse(res, 404, { error: `Subject "${subjectName}" not found` });
        return;
      }

      const questions = getQuestionsBySubject(subject.id, 200);
      if (questions.length === 0) {
        jsonResponse(res, 404, { error: "No questions for this subject" });
        return;
      }

      const selected = questions
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(questionCount, questions.length));

      const sessionId = createQuizSession(subject.id, jid);

      jsonResponse(res, 200, {
        session_id: sessionId,
        subject: subjectName,
        questions: selected.map((q) => ({
          id: q.id,
          text: q.question_text,
          type: q.question_type,
          options: q.options ? JSON.parse(q.options) : null,
        })),
      });
      return;
    }

    // POST /api/quiz/answer → submit answer
    if (req.method === "POST" && pathname === "/api/quiz/answer") {
      const body = await parseBody(req);
      const jid = (body.jid as string) || webJid;
      const sessionId = body.session_id as number;
      const questionId = body.question_id as number;
      const answer = (body.answer as string) || "";

      if (!sessionId || !questionId) {
        jsonResponse(res, 400, { error: "session_id and question_id required" });
        return;
      }

      const question = getQuestionById(questionId);
      if (!question) {
        jsonResponse(res, 404, { error: "Question not found" });
        return;
      }

      const sa = answer.trim().toLowerCase();
      const ca = question.answer.trim().toLowerCase();
      const correct =
        question.question_type === "multiple_choice"
          ? sa === ca
          : sa.includes(ca) || ca.includes(sa);

      recordQuizAnswer(sessionId, questionId, answer, correct);

      if (!correct) {
        recordWrongQuestion(questionId, jid);
      }

      const answers = getQuizSessionAnswers(sessionId);

      jsonResponse(res, 200, {
        correct,
        explanation: question.explanation,
        answered_count: answers.length,
      });
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  const channel: Channel = {
    name: "web",
    connect: async () => {
      // Auto-register web group
      setRegisteredGroup(webJid, {
        name: "Web Console",
        folder: "main",
        trigger: DEFAULT_TRIGGER,
        added_at: new Date().toISOString(),
        requiresTrigger: false,
        isMain: true,
      });

      server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          logger.error({ err }, "HTTP request error");
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal error" }));
          }
        });
      });

      return new Promise((resolve) => {
        server.listen(WEBCLIENT_PORT, () => {
          logger.info({ port: WEBCLIENT_PORT }, "Web channel listening");
          resolve();
        });
      });
    },

    sendMessage: async (jid: string, text: string) => {
      pushSse(jid, "done", { status: "success", text });
    },

    sendChunk: async (jid: string, chunk: { thinking?: string; content?: string }) => {
      if (chunk.thinking) pushSse(jid, "thinking", { text: chunk.thinking });
      if (chunk.content) pushSse(jid, "token", { text: chunk.content });
    },

    isConnected: () => server?.listening ?? false,

    ownsJid: (jid: string) => jid.startsWith("web:"),

    disconnect: async () => {
      // Close all SSE connections
      for (const [, clients] of sseClients) {
        for (const res of clients) {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      }
      sseClients.clear();
      return new Promise((resolve) => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    },

    setTyping: async (jid: string, isTyping: boolean) => {
      pushSse(jid, "typing", { isTyping });
    },
  };

  return channel;
}
