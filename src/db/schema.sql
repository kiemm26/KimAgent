-- ================================================================
-- KIM-AGENT SQLite Schema
-- Optimized for WAL mode & high-frequency reads
-- ================================================================

-- Enable WAL mode (applied programmatically, schema here for reference)
-- PRAGMA journal_mode = WAL;
-- PRAGMA synchronous = NORMAL;
-- PRAGMA foreign_keys = ON;
-- PRAGMA busy_timeout = 5000;

-- ----------------------------------------------------------------
-- Messages: Conversation history per JID
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jid         TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content     TEXT    NOT NULL,
  tool_calls  TEXT,                            -- JSON array of tool calls
  metadata    TEXT    DEFAULT '{}',            -- JSON: messageId, timestamp, etc.
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_messages_jid_created ON messages (jid, created_at DESC);

-- ----------------------------------------------------------------
-- Todos: Task management
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jid         TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  description TEXT    DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  priority    TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_at      INTEGER,                         -- Unix timestamp (nullable)
  tags        TEXT    DEFAULT '[]',            -- JSON array of tag strings
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  done_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_todos_jid_status ON todos (jid, status);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos (due_at) WHERE due_at IS NOT NULL;

-- ----------------------------------------------------------------
-- Notes: Free-form notes & knowledge store
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jid         TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  tags        TEXT    DEFAULT '[]',            -- JSON array
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notes_jid ON notes (jid, pinned DESC, updated_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, content, content='notes', content_rowid='id');

-- ----------------------------------------------------------------
-- Reminders: Scheduled alerts
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jid         TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  remind_at   INTEGER NOT NULL,               -- Unix timestamp
  recurrence  TEXT    DEFAULT NULL,           -- cron expression (nullable = one-time)
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_reminders_active ON reminders (remind_at, status) WHERE status = 'active';

-- ----------------------------------------------------------------
-- Skills: Procedural memory (Voyager pattern)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
  id          TEXT    PRIMARY KEY,            -- UUID
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  trigger_patterns TEXT NOT NULL DEFAULT '[]', -- JSON array
  tools_used  TEXT    NOT NULL DEFAULT '[]',  -- JSON array
  content     TEXT    NOT NULL,               -- Full Markdown skill content
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL   NOT NULL DEFAULT 1.0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ----------------------------------------------------------------
-- System logs: Audit trail for debugging
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  level       TEXT    NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source      TEXT    NOT NULL,               -- module name
  message     TEXT    NOT NULL,
  metadata    TEXT    DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON system_logs (created_at DESC);
-- Auto-prune logs older than 7 days (applied via scheduled job)
