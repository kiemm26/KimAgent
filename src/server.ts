// src/server.ts
// Fastify HTTP server — receives WAHA webhook events
import Fastify from "fastify";
import { env } from "./config.js";
import { logger } from "./logger.js";
import { BurstDebouncer } from "./gateway/debouncer.js";
import { routeMessage } from "./core/router.js";
import { getDb, closeDb, walCheckpoint } from "./db/sqlite.js";
import { getWahaClient } from "./gateway/waha.js";
import type { WahaWebhookPayload, WahaMessagePayload } from "./types.js";

// Initialize debouncer — routes flushed messages to the main router
const debouncer = new BurstDebouncer((msg) => {
  routeMessage(msg).catch((err) =>
    logger.error({ err, jid: msg.jid }, "Router failed to handle message")
  );
});

export function buildServer() {
  const app = Fastify({
    logger: false, // We use pino directly
    trustProxy: true,
  });

  // ── Webhook endpoint: receives all events from WAHA ─────────────
  app.post("/api/webhook", async (req, reply) => {
    const payload = req.body as WahaWebhookPayload;

    // Log raw event for debugging
    logger.debug({ event: payload.event }, "Webhook received");

    // Only process incoming text messages
    if (payload.event !== "message") {
      return reply.code(200).send({ ok: true });
    }

    const msgPayload = payload.payload as WahaMessagePayload;

    // Skip outgoing messages (fromMe = true)
    if (msgPayload.fromMe) {
      return reply.code(200).send({ ok: true });
    }

    // Skip empty messages
    if (!msgPayload.body?.trim()) {
      return reply.code(200).send({ ok: true });
    }

    const jid = msgPayload.from;
    logger.info({ jid, preview: msgPayload.body.slice(0, 60) }, "Incoming message");

    // Push to debouncer (non-blocking)
    debouncer.push(jid, msgPayload);

    return reply.code(200).send({ ok: true });
  });

  // ── Health check endpoint ─────────────────────────────────────────
  app.get("/api/health", async (_req, reply) => {
    const waha = getWahaClient();
    const wahaOk = await waha.healthCheck();
    const dbOk = (() => {
      try { getDb(); return true; } catch { return false; }
    })();

    return reply.code(wahaOk && dbOk ? 200 : 503).send({
      status: wahaOk && dbOk ? "ok" : "degraded",
      services: {
        waha: wahaOk ? "up" : "down",
        db: dbOk ? "up" : "down",
      },
      uptime: process.uptime(),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      pendingDebounce: debouncer.pendingCount,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Status endpoint ───────────────────────────────────────────────
  app.get("/api/status", async (_req, reply) => {
    return reply.send({
      name: "kim-agent",
      version: "1.0.0",
      env: env.NODE_ENV,
      ownerJid: env.OWNER_JID,
      wahaSession: env.WAHA_SESSION,
    });
  });

  return { app, debouncer };
}

export async function startServer(): Promise<{ stop: () => Promise<void> }> {
  const { app, debouncer } = buildServer();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ port: env.PORT }, "kim-agent HTTP server started");

  // Graceful shutdown handler
  const stop = async () => {
    logger.info("Graceful shutdown: flushing debouncer...");
    debouncer.flushAll();
    await new Promise((r) => setTimeout(r, 500)); // Wait for flush
    logger.info("Graceful shutdown: WAL checkpoint...");
    walCheckpoint();
    closeDb();
    await app.close();
    logger.info("Server stopped cleanly");
  };

  return { stop };
}
