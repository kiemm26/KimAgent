// src/tools/reminders.ts
// Reminder management tools
import { dbQuery, dbRun } from "../db/sqlite.js";
import type { ToolDefinition, ToolHandler, ReminderRow } from "../types.js";

export const reminderToolDefinitions: ToolDefinition[] = [
  {
    name: "create_reminder",
    description: "Create a reminder that will notify the user at a specific time.",
    parameters: {
      type: "object",
      properties: {
        jid: { type: "string", description: "User WhatsApp JID" },
        title: { type: "string", description: "Short reminder title" },
        message: { type: "string", description: "Full reminder message to send to the user" },
        remind_at: { type: "number", description: "Unix timestamp when to send the reminder" },
        recurrence: { type: "string", description: "Optional cron expression for recurring reminder (e.g. '0 9 * * 1' for every Monday at 9am)" },
      },
      required: ["jid", "title", "message", "remind_at"],
    },
  },
  {
    name: "get_reminders",
    description: "Get list of active reminders for the user.",
    parameters: {
      type: "object",
      properties: {
        jid: { type: "string", description: "User WhatsApp JID" },
        status: { type: "string", description: "Filter by status", enum: ["active", "triggered", "cancelled", "all"] },
      },
      required: ["jid"],
    },
  },
  {
    name: "cancel_reminder",
    description: "Cancel an active reminder by ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Reminder ID to cancel" },
      },
      required: ["id"],
    },
  },
];

export const reminderToolHandlers: Record<string, ToolHandler> = {
  create_reminder: (args) => {
    const jid = String(args["jid"] ?? "");
    const title = String(args["title"] ?? "");
    const message = String(args["message"] ?? "");
    const remind_at = Number(args["remind_at"]);
    const recurrence = args["recurrence"] ? String(args["recurrence"]) : null;

    if (!remind_at || remind_at < Date.now() / 1000) {
      return "❌ remind_at must be a future Unix timestamp.";
    }

    const result = dbRun(
      `INSERT INTO reminders (jid, title, message, remind_at, recurrence) VALUES (?, ?, ?, ?, ?)`,
      [jid, title, message, remind_at, recurrence]
    );

    const remindDate = new Date(remind_at * 1000).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    const recurrenceText = recurrence ? ` (Berulang: ${recurrence})` : "";
    return `⏰ Reminder dibuat [ID: ${result.lastInsertRowid}]: *${title}*\n📅 Waktu: ${remindDate} WIB${recurrenceText} [^db]`;
  },

  get_reminders: (args) => {
    const jid = String(args["jid"] ?? "");
    const status = String(args["status"] ?? "active");
    let sql: string;
    let params: (string | number | null)[];

    if (status === "all") {
      sql = `SELECT id, title, message, remind_at, recurrence, status FROM reminders WHERE jid = ? ORDER BY remind_at ASC LIMIT 20`;
      params = [jid];
    } else {
      sql = `SELECT id, title, message, remind_at, recurrence, status FROM reminders WHERE jid = ? AND status = ? ORDER BY remind_at ASC LIMIT 20`;
      params = [jid, status];
    }

    const rows = dbQuery<ReminderRow>(sql, params);
    if (rows.length === 0) return `No ${status} reminders found. [^db]`;

    const list = rows.map((r) => {
      const time = new Date(r.remind_at * 1000).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const rec = r.recurrence ? ` 🔁` : "";
      return `⏰ [${r.id}] *${r.title}* — ${time} WIB${rec}`;
    }).join("\n");

    return `${list}\n\n_Total: ${rows.length} reminders_ [^db]`;
  },

  cancel_reminder: (args) => {
    const id = Number(args["id"]);
    const existing = dbQuery<ReminderRow>(`SELECT id, title FROM reminders WHERE id = ?`, [id]);
    if (!existing[0]) return `❌ Reminder ID ${id} not found.`;
    dbRun(`UPDATE reminders SET status = 'cancelled' WHERE id = ?`, [id]);
    return `🚫 Reminder [${id}] "${existing[0].title}" cancelled. [^db]`;
  },
};
