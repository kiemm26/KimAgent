// src/db/migrate.ts
// Standalone migration runner — run via: npm run db:migrate
import { getDb, closeDb } from "./sqlite.js";
import { logger } from "../logger.js";

async function main(): Promise<void> {
  logger.info("Running database migrations...");
  try {
    getDb(); // triggers schema apply
    logger.info("✅ Migrations complete");
  } finally {
    closeDb();
  }
}

main().catch((err) => {
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
