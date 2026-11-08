// src/index.ts
// KIM-AGENT — Application Entrypoint
// Handles startup, graceful shutdown (SIGTERM/SIGINT), and InstaBox resilience
import dotenv from "dotenv";
dotenv.config({ override: true });
import { logger } from "./logger.js";

import { getDb } from "./db/sqlite.js";
import { startServer } from "./server.js";
import { startScheduler } from "./scheduler.js";
import { getRotator } from "./llm/rotator.js";
import { getWahaClient } from "./gateway/waha.js";
import { env } from "./config.js";

async function main(): Promise<void> {
  logger.info("🚀 KIM-AGENT starting up...");
  logger.info({ nodeVersion: process.version, env: env.NODE_ENV }, "Runtime info");

  // ── 1. Initialize Database ──────────────────────────────────────
  logger.info("Initializing SQLite database (WAL mode)...");
  getDb();
  logger.info("✅ Database ready");

  // ── 2. Initialize LLM Rotator ───────────────────────────────────
  const rotator = getRotator();
  const health = rotator.getHealthReport();
  if (health.healthy === 0) {
    logger.warn("⚠️  No healthy LLM API keys! Check GEMINI_KEYS in .env");
  } else {
    logger.info({ healthy: health.healthy, total: health.total }, "✅ LLM rotator initialized");
  }

  // ── 3. WAHA Session Auto-Start ──────────────────────────────────
  logger.info("Checking WAHA gateway...");
  const waha = getWahaClient();
  const wahaOk = await waha.healthCheck();
  if (wahaOk) {
    const sessionStatus = await waha.getSessionStatus();
    logger.info({ sessionStatus }, "✅ WAHA gateway connected");

    if (sessionStatus === "STOPPED" || sessionStatus === "FAILED") {
      logger.info("Auto-starting WAHA session...");
      await waha.startSession();
    }
  } else {
    logger.warn("⚠️  WAHA gateway not reachable. Will retry on next health check.");
  }

  // ── 4. Start Scheduler ──────────────────────────────────────────
  logger.info("Starting cron schedulers...");
  startScheduler();
  logger.info("✅ Schedulers running");

  // ── 5. Start HTTP Server ────────────────────────────────────────
  logger.info(`Starting HTTP server on port ${env.PORT}...`);
  const { stop } = await startServer();
  logger.info("✅ HTTP server listening");

  logger.info("🎉 KIM-AGENT fully started. Waiting for WhatsApp messages...");



  // ── 6. Graceful Shutdown ─────────────────────────────────────────
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received. Shutting down gracefully...");
    try {
      await stop();
      logger.info("✅ Graceful shutdown complete");
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Handle uncaught exceptions to prevent silent crashes
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — this is a bug!");
    // Don't exit — let the process continue (PM2 handles restarts)
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
