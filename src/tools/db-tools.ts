// src/tools/db-tools.ts
// SQLite-backed tools: todos, notes, skill retrieval
import { dbQuery, dbQueryOne, dbRun } from "../db/sqlite.js";
import type { ToolDefinition, ToolHandler, TodoRow, NoteRow, SkillRow } from "../types.js";

// ----------------------------------------------------------------
// Tool Handlers
// ----------------------------------------------------------------

export const dbToolHandlers: Record<string, ToolHandler> = {
  db_query: (args) => {
    const sql = String(args["sql"] ?? "");
    const params = Array.isArray(args["params"]) ? (args["params"] as (string | number | null)[]) : [];
    if (!/^\s*SELECT\s/i.test(sql)) return "❌ Only SELECT queries are allowed via db_query tool.";
    const rows = dbQuery<Record<string, unknown>>(sql, params);
    return rows.length === 0 ? "No results found." : JSON.stringify(rows, null, 2) + ` [^db] (${rows.length} rows)`;
  },

  todo_create: (args) => {
    const jid = String(args["jid"] ?? "");
    const title = String(args["title"] ?? "");
    const description = String(args["description"] ?? "");
    const priority = String(args["priority"] ?? "medium");
    const due_at = typeof args["due_at"] === "number" ? args["due_at"] : null;
    const tags = Array.isArray(args["tags"]) ? JSON.stringify(args["tags"]) : "[]";
    const result = dbRun(
      `INSERT INTO todos (jid, title, description, priority, due_at, tags) VALUES (?, ?, ?, ?, ?, ?)`,
      [jid, title, description, priority, due_at, tags]
    );
    return `✅ Todo created with ID ${result.lastInsertRowid}: "${title}" [^db]`;
  },

  todo_list: (args) => {
    const jid = String(args["jid"] ?? "");
    const status = String(args["status"] ?? "pending");
    const limit = typeof args["limit"] === "number" ? args["limit"] : 20;
    let sql: string;
    let params: (string | number | null)[];
    if (status === "all") {
      sql = `SELECT id, title, status, priority, due_at FROM todos WHERE jid = ? ORDER BY created_at DESC LIMIT ?`;
      params = [jid, limit];
    } else {
      sql = `SELECT id, title, status, priority, due_at FROM todos WHERE jid = ? AND status = ? ORDER BY created_at DESC LIMIT ?`;
      params = [jid, status, limit];
    }
    const rows = dbQuery<TodoRow>(sql, params);
    if (rows.length === 0) return `No ${status} todos found. [^db]`;
    const list = rows.map((r) => {
      const due = r.due_at ? ` | Due: ${new Date(r.due_at * 1000).toLocaleString("id-ID")}` : "";
      const icon = { low: "🔵", medium: "🟡", high: "🟠", urgent: "🔴" }[r.priority] ?? "⚪";
      return `${icon} [${r.id}] *${r.title}* (${r.status})${due}`;
    }).join("\n");
    return `${list}\n\n_Total: ${rows.length} items_ [^db]`;
  },

  todo_update_status: (args) => {
    const id = Number(args["id"]);
    const status = String(args["status"] ?? "");
    const existing = dbQueryOne<{ id: number; title: string }>(`SELECT id, title FROM todos WHERE id = ?`, [id]);
    if (!existing) return `❌ Todo ID ${id} not found.`;
    const now = Math.floor(Date.now() / 1000);
    dbRun(`UPDATE todos SET status = ?, updated_at = ?, done_at = ? WHERE id = ?`, [status, now, status === "done" ? now : null, id]);
    const icon = status === "done" ? "✅" : status === "cancelled" ? "🚫" : "🔄";
    return `${icon} Todo [${id}] "${existing.title}" updated to *${status}* [^db]`;
  },

  note_save: (args) => {
    const jid = String(args["jid"] ?? "");
    const title = String(args["title"] ?? "");
    const content = String(args["content"] ?? "");
    const tags = Array.isArray(args["tags"]) ? JSON.stringify(args["tags"]) : "[]";
    const result = dbRun(`INSERT INTO notes (jid, title, content, tags) VALUES (?, ?, ?, ?)`, [jid, title, content, tags]);
    return `✅ Note saved with ID ${result.lastInsertRowid}: "${title}" [^db]`;
  },

  note_search: (args) => {
    const jid = String(args["jid"] ?? "");
    const query = String(args["query"] ?? "");
    const rows = dbQuery<NoteRow>(
      `SELECT n.id, n.title, n.content FROM notes n JOIN notes_fts f ON n.id = f.rowid WHERE notes_fts MATCH ? AND n.jid = ? ORDER BY rank LIMIT 5`,
      [query, jid]
    );
    if (rows.length === 0) {
      const likeRows = dbQuery<NoteRow>(`SELECT id, title, content FROM notes WHERE jid = ? AND (title LIKE ? OR content LIKE ?) LIMIT 5`, [jid, `%${query}%`, `%${query}%`]);
      if (likeRows.length === 0) return `No notes found for "${query}". [^db]`;
      return likeRows.map((r) => `📝 [${r.id}] *${r.title}*\n${r.content.slice(0, 200)}`).join("\n\n") + " [^db]";
    }
    return rows.map((r) => `📝 [${r.id}] *${r.title}*\n${r.content.slice(0, 200)}`).join("\n\n") + " [^db]";
  },

  skill_retrieve: (args) => {
    const query = String(args["query"] ?? "");
    const rows = dbQuery<SkillRow>(
      `SELECT id, title, description, content FROM skills WHERE title LIKE ? OR description LIKE ? OR trigger_patterns LIKE ? ORDER BY usage_count DESC LIMIT 3`,
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );
    if (rows.length === 0) return `No matching procedural skills found for "${query}". [^mem]`;
    return rows.map((s) => `📌 *${s.title}*\n${s.description}\n\n${s.content}`).join("\n\n---\n\n") + " [^mem]";
  },
};


export const dbToolDefinitions: ToolDefinition[] = [
  {
    name: "db_query",
    description:
      "Execute a read-only SQL SELECT query against the kim database. Use for fetching todos, notes, reminders, or any stored data.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "The SELECT SQL query to execute. Must be read-only." },
        params: {
          type: "array",
          description: "Optional parameter values for the SQL query.",
          items: { type: "string", description: "Query parameter" },
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "todo_create",
    description: "Create a new todo task for the user.",
    parameters: {
      type: "object",
      properties: {
        jid: { type: "string", description: "User WhatsApp JID" },
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Optional task description" },
        priority: { type: "string", description: "Priority level", enum: ["low", "medium", "high", "urgent"] },
        due_at: { type: "number", description: "Optional Unix timestamp for due date" },
        tags: { type: "array", description: "Optional list of tags", items: { type: "string", description: "Tag" } },
      },
      required: ["jid", "title"],
    },
  },
  {
    name: "todo_list",
    description: "List todos for a user, optionally filtered by status.",
    parameters: {
      type: "object",
      properties: {
        jid: { type: "string", description: "User WhatsApp JID" },
        status: { type: "string", description: "Filter by status", enum: ["pending", "in_progress", "done", "cancelled", "all"] },
        limit: { type: "number", description: "Max number of results (default 20)" },
      },
      required: ["jid"],
    },
  },
  {
    name: "todo_update_status",
    description: "Update the status of a todo task.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Todo ID" },
        status: { type: "string", description: "New status", enum: ["pending", "in_progress", "done", "cancelled"] },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "note_save",
    description: "Save a new note to the user's knowledge base.",
    parameters: {
      type: "object",
      properties: {
        jid: { type: "string", description: "User WhatsApp JID" },
        title: { type: "string", description: "Note title" },
        content: { type: "string", description: "Note content in Markdown" },
        tags: { type: "array", description: "Optional tags", items: { type: "string", description: "Tag" } },
      },
      required: ["jid", "title", "content"],
    },
  },
  {
    name: "note_search",
    description: "Search notes by keyword using full-text search.",
    parameters: {
      type: "object",
      properties: {
        jid: { type: "string", description: "User WhatsApp JID" },
        query: { type: "string", description: "Search keyword or phrase" },
      },
      required: ["jid", "query"],
    },
  },
  {
    name: "skill_retrieve",
    description: "Retrieve a stored procedural skill / procedure from memory.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or description of the skill to look up" },
      },
      required: ["query"],
    },
  },
];
