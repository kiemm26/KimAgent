// src/db/sqlite.ts
// SQLite WAL database wrapper using better-sqlite3
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

/**
 * Get the singleton SQLite database instance.
 * Applies WAL mode and performance pragmas on first open.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env["DB_PATH"] ?? "./data/db/kim.db";

  logger.info({ dbPath }, "Opening SQLite database");

  _db = new Database(dbPath, {
    verbose: process.env["NODE_ENV"] === "development"
      ? (sql) => logger.debug({ sql }, "SQLite query")
      : undefined,
  });

  // --- Performance & Safety Pragmas ---
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");
  _db.pragma("cache_size = -32000");   // 32MB page cache
  _db.pragma("temp_store = MEMORY");
  _db.pragma("mmap_size = 268435456"); // 256MB mmap

  logger.info("SQLite pragmas applied (WAL, NORMAL sync)");

  // --- Apply Schema ---
  applySchema(_db);

  return _db;
}

/**
 * Apply the schema DDL (idempotent — uses CREATE IF NOT EXISTS).
 */
function applySchema(db: Database.Database): void {
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf8");

  // Strip comment-only lines referencing PRAGMA (they're in schema for reference)
  const cleaned = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("-- PRAGMA"))
    .join("\n");

  db.exec(cleaned);
  logger.info("SQLite schema applied");
}

/**
 * Graceful shutdown: checkpoint WAL and close the connection.
 * Call this in SIGTERM handler before process exit.
 */
export function closeDb(): void {
  if (!_db) return;
  try {
    logger.info("Running WAL checkpoint before close...");
    _db.pragma("wal_checkpoint(TRUNCATE)");
    _db.close();
    _db = null;
    logger.info("SQLite database closed cleanly");
  } catch (err) {
    logger.error({ err }, "Error during SQLite shutdown");
  }
}

/**
 * Run a WAL checkpoint manually (called by cron scheduler).
 */
export function walCheckpoint(): void {
  const db = getDb();
  const result = db.pragma("wal_checkpoint(PASSIVE)") as Array<{
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  logger.info({ result }, "WAL checkpoint executed");
}

// ----------------------------------------------------------------
// Generic query helpers (typed, synchronous)
// ----------------------------------------------------------------

export function dbQuery<T extends object>(
  sql: string,
  params: (string | number | null)[] = []
): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function dbQueryOne<T extends object>(
  sql: string,
  params: (string | number | null)[] = []
): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function dbRun(
  sql: string,
  params: (string | number | null)[] = []
): Database.RunResult {
  return getDb().prepare(sql).run(...params);
}

export function dbTransaction<T>(fn: (db: Database.Database) => T): T {
  return getDb().transaction(fn)(getDb());
}
