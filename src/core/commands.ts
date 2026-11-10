// src/core/commands.ts -- Deterministic fast command parser
import { dbQuery, dbRun, walCheckpoint } from "../db/sqlite.js";
import { getRotator } from "../llm/rotator.js";
import { getWahaClient } from "../gateway/waha.js";
import { env } from "../config.js";
import { checkRunnerHealth } from "../tools/compute.js";
import { logger } from "../logger.js";
import type { TodoRow, ReminderRow } from "../types.js";

export interface CommandResult { handled: boolean; response?: string; }

export async function handleCommand(text: string, jid: string): Promise<CommandResult> {
  const t = text.trim();
  if (!t.startsWith("#")) return { handled: false };
  const parts = t.slice(1).split(" ");
  const cmd = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1).join(" ").trim();
  logger.info({ cmd, args, jid }, "Fast command");
  switch (cmd) {
    case "ping": return { handled: true, response: cmdPing() };
    case "help": return { handled: true, response: cmdHelp() };
    case "health": return { handled: true, response: await cmdHealth() };
    case "todo": return { handled: true, response: cmdTodoList(jid, args) };
    case "add": return { handled: true, response: cmdTodoAdd(jid, args) };
    case "done": return { handled: true, response: cmdTodoDone(jid, args) };
    case "reminders": return { handled: true, response: cmdReminders(jid) };
    case "skills": return { handled: true, response: cmdSkills() };
    case "clear": { dbRun("DELETE FROM messages WHERE jid=?", [jid]); return { handled: true, response: "History dihapus." }; }
    case "checkpoint": { walCheckpoint(); return { handled: true, response: "WAL checkpoint berhasil." }; }
    case "waha": return { handled: true, response: await cmdWaha() };
    default: return { handled: true, response: "Perintah tidak dikenali. Ketik #help" };
  }
}

function cmdPing(): string {
  const mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  return "Pong! Uptime: " + fmtUp(process.uptime()) + " Memory: " + mb + "MB";
}

function cmdHelp(): string {
  return "KIM Commands:\n#ping #health #waha\n#todo [status] #add [task] #done [id]\n#reminders #skills #clear #checkpoint\nAI Mode: Kirim pesan biasa";
}

async function cmdHealth(): Promise<string> {
  const r = getRotator().getHealthReport();
  const mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const runnerOk = await checkRunnerHealth();
  const kl = r.keys.map((k: { healthy: boolean; provider: string; model: string; requestCount: number; errorCount: number }, i: number) =>
    "  " + (k.healthy ? "healthy" : "cooldown") + " Slot" + (i+1) + "[" + k.model + "] " + k.requestCount + "req/" + k.errorCount + "err"
  ).join("\n");
  return "Health: " + mb + "MB | Runner: " + (runnerOk ? "Online ✅" : "Offline ❌") + "\nModel Slots(" + r.healthy + "/" + r.total + "):\n" + kl;
}

function cmdTodoList(jid: string, args: string): string {
  const st = ["pending","in_progress","done","cancelled","all"].includes(args) ? args : "pending";
  const params: (string|number|null)[] = st === "all" ? [jid] : [jid, st];
  const sql = st === "all"
    ? "SELECT id,title,status,priority FROM todos WHERE jid=? ORDER BY created_at DESC LIMIT 20"
    : "SELECT id,title,status,priority FROM todos WHERE jid=? AND status=? ORDER BY created_at DESC LIMIT 20";
  const rows = dbQuery<TodoRow>(sql, params);
  if (!rows.length) return "Tidak ada tugas " + st + ".";
  return "Todo (" + st + "):\n" + rows.map((r: TodoRow) => "[" + r.id + "] " + r.title + " (" + r.status + ")").join("\n");
}

function cmdTodoAdd(jid: string, args: string): string {
  if (!args.trim()) return "Format: #add [tugas]";
  const res = dbRun("INSERT INTO todos (jid,title,priority) VALUES (?,?,'medium')", [jid, args.trim()]);
  return "Ditambahkan [ID:" + String(res.lastInsertRowid) + "]: " + args.trim();
}

function cmdTodoDone(jid: string, args: string): string {
  const id = parseInt(args.trim(), 10);
  if (isNaN(id)) return "Format: #done [id]";
  const rows = dbQuery<{id:number;title:string;jid:string}>("SELECT id,title,jid FROM todos WHERE id=?",[id]);
  if (!rows[0] || rows[0].jid !== jid) return "Tugas tidak ditemukan.";
  const now = Math.floor(Date.now()/1000);
  dbRun("UPDATE todos SET status='done',updated_at=?,done_at=? WHERE id=?",[now,now,id]);
  return "Selesai: " + (rows[0]?.title ?? "");
}

function cmdReminders(jid: string): string {
  const rows = dbQuery<ReminderRow>("SELECT id,title,remind_at,recurrence FROM reminders WHERE jid=? AND status='active' ORDER BY remind_at ASC LIMIT 10",[jid]);
  if (!rows.length) return "Tidak ada pengingat aktif.";
  return "Reminders:\n" + rows.map((r: ReminderRow) => "[" + r.id + "] " + r.title).join("\n");
}

function cmdSkills(): string {
  const rows = dbQuery<{title:string;usage_count:number}>("SELECT title,usage_count FROM skills ORDER BY usage_count DESC LIMIT 15",[]);
  if (!rows.length) return "Belum ada skill.";
  return "Skills:\n" + rows.map((s: {title:string;usage_count:number}, i: number) => String(i+1) + ". " + s.title).join("\n");
}

async function cmdWaha(): Promise<string> {
  const waha = getWahaClient();
  const results = await Promise.all([waha.healthCheck(), waha.getSessionStatus()]);
  const ok = results[0] as boolean;
  const st = results[1] as string;
  return "WAHA: " + (ok ? "Online" : "Offline") + ", Session(" + env.WAHA_SESSION + "): " + st;
}

function fmtUp(sec: number): string {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return h > 0 ? h + "j " + m + "m" : m > 0 ? m + "m " + s + "d" : s + "d";
}
