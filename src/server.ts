// src/server.ts
// Native Node.js HTTP server — ultra-fast (<1ms boot), zero-hang, receives WAHA webhooks
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { env } from "./config.js";
import { logger } from "./logger.js";
import { BurstDebouncer } from "./gateway/debouncer.js";
import { routeMessage } from "./core/router.js";
import { getDb, closeDb, walCheckpoint } from "./db/sqlite.js";
import { getWahaClient } from "./gateway/waha.js";
import { checkRunnerHealth } from "./tools/compute.js";

import type { WahaWebhookPayload, WahaMessagePayload } from "./types.js";

// Initialize debouncer — routes flushed messages to the main router
const debouncer = new BurstDebouncer((msg) => {
  routeMessage(msg).catch((err) =>
    logger.error({ err, jid: msg.jid }, "Router failed to handle message")
  );
});

async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {} as T;
  return JSON.parse(raw) as T;
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function buildServer(): { server: Server; debouncer: BurstDebouncer } {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    try {
      // ── Webhook endpoint ──────────────────────────────────────────
      if (pathname === "/api/webhook" && method === "POST") {
        const payload = await readJsonBody<WahaWebhookPayload>(req);
        logger.debug({ event: payload.event }, "Webhook received");

        if (payload.event !== "message") {
          return sendJson(res, 200, { ok: true });
        }

        const msgPayload = payload.payload as WahaMessagePayload;
        const text = msgPayload.body?.trim() ?? "";
        if (!text) {
          return sendJson(res, 200, { ok: true });
        }

        const jid = msgPayload.from;
        const to = msgPayload.to;
        const isSelfChat = jid === to || (msgPayload._data as { id?: { remote?: string } })?.id?.remote === jid;

        // Skip outgoing messages unless it's a message sent to self
        if (msgPayload.fromMe && !isSelfChat) {
          logger.debug({ jid, to }, "Skipping outgoing non-self message");
          return sendJson(res, 200, { ok: true });
        }

        console.log(`\n📩 [INCOMING WA] from: ${jid} | text: "${text}"`);
        logger.info({ jid, text, fromMe: msgPayload.fromMe }, "Incoming message accepted");

        debouncer.push(jid, msgPayload);
        return sendJson(res, 200, { ok: true });
      }


      // ── Health check endpoint ─────────────────────────────────────
      if (pathname === "/api/health" && method === "GET") {
        const waha = getWahaClient();
        const [wahaOk, runnerOk] = await Promise.all([
          waha.healthCheck(),
          checkRunnerHealth(),
        ]);
        let dbOk = false;
        try { getDb(); dbOk = true; } catch { dbOk = false; }

        return sendJson(res, wahaOk && dbOk ? 200 : 503, {
          status: wahaOk && dbOk ? "ok" : "degraded",
          services: {
            waha: wahaOk ? "up" : "down",
            db: dbOk ? "up" : "down",
            pythonRunner: runnerOk ? "up" : "down",
          },
          uptime: process.uptime(),
          memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          pendingDebounce: debouncer.pendingCount,
          timestamp: new Date().toISOString(),
        });
      }

      // ── Status endpoint ───────────────────────────────────────────
      if (pathname === "/api/status" && method === "GET") {
        return sendJson(res, 200, {
          name: "kim-agent",
          version: "1.0.0",
          env: env.NODE_ENV,
          ownerJid: env.OWNER_JID,
          wahaSession: env.WAHA_SESSION,
        });
      }

      // Default 404
      return sendJson(res, 404, { error: "Not Found", pathname });
    } catch (err) {
      logger.error({ err, pathname, method }, "HTTP request handler error");
      return sendJson(res, 500, { error: "Internal Server Error" });
    }
  });

  return { server, debouncer };
}

export async function startServer(): Promise<{ stop: () => Promise<void> }> {
  const { server, debouncer } = buildServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.PORT, "0.0.0.0", () => {
      logger.info({ port: env.PORT }, "kim-agent HTTP server listening");
      resolve();
    });
  });

  // Graceful shutdown handler
  const stop = async () => {
    logger.info("Graceful shutdown: flushing debouncer...");
    debouncer.flushAll();
    await new Promise((r) => setTimeout(r, 500));
    logger.info("Graceful shutdown: WAL checkpoint...");
    walCheckpoint();
    closeDb();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info("Server stopped cleanly");
  };

  return { stop };
}

