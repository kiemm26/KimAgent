// src/scheduler.ts
// Cron job scheduler — reminders, WAL checkpoint, DB backup
import cron from "node-cron";
import { dbQuery, dbRun, walCheckpoint } from "./db/sqlite.js";
import { getWahaClient } from "./gateway/waha.js";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";
import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ReminderRow } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startScheduler(): void {
  const config = getConfig();

  // ── 1. Reminder Checker (every minute) ─────────────────────────
  cron.schedule(config.scheduler.reminderCheckCron, async () => {
    try {
      await checkAndFireReminders();
    } catch (err) {
      logger.error({ err }, "Scheduler: reminder check failed");
    }
  });
  logger.info({ cron: config.scheduler.reminderCheckCron }, "Scheduler: reminder checker started");

  // ── 2. WAL Checkpoint (every 6 hours) ───────────────────────────
  cron.schedule(config.scheduler.walCheckpointCron, () => {
    logger.info("Scheduler: running WAL checkpoint");
    walCheckpoint();
  });

  // ── 3. DB Backup (daily at 2am) ─────────────────────────────────
  cron.schedule(config.scheduler.dbBackupCron, () => {
    logger.info("Scheduler: running database backup");
    try {
      const scriptPath = join(__dirname, "..", "scripts", "backup-db.sh");
      execFileSync("bash", [scriptPath], {
        env: {
          ...process.env,
          DB_PATH: process.env["DB_PATH"] ?? "./data/db/kim.db",
          BACKUP_DIR: "./data/backups",
        },
      });
      logger.info("Scheduler: database backup completed");
    } catch (err) {
      logger.error({ err }, "Scheduler: database backup failed");
    }
  });

  // ── 4. Prune old messages (daily at 3am) ─────────────────────────
  cron.schedule("0 3 * * *", () => {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    dbRun(`DELETE FROM system_logs WHERE created_at < ?`, [sevenDaysAgo]);
    // Keep messages for 30 days
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    dbRun(`DELETE FROM messages WHERE created_at < ?`, [thirtyDaysAgo]);
    logger.info("Scheduler: old records pruned");
  });

  logger.info("All schedulers started");
}

async function checkAndFireReminders(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const dueReminders = dbQuery<ReminderRow>(
    `SELECT * FROM reminders WHERE status = 'active' AND remind_at <= ? LIMIT 10`,
    [now]
  );

  if (dueReminders.length === 0) return;

  logger.info({ count: dueReminders.length }, "Scheduler: firing reminders");
  const waha = getWahaClient();

  for (const reminder of dueReminders) {
    try {
      const text = `⏰ *Pengingat: ${reminder.title}*\n\n${reminder.message}`;
      await waha.sendWithTypingEffect(reminder.jid, text);

      if (reminder.recurrence) {
        // For recurring reminders: update next fire time (simplified)
        // A full implementation would use cron-parser to calculate next time
        logger.info({ id: reminder.id, recurrence: reminder.recurrence }, "Recurring reminder — keeping active");
        dbRun(`UPDATE reminders SET remind_at = remind_at + 86400 WHERE id = ?`, [reminder.id]);
      } else {
        // One-time: mark as triggered
        dbRun(`UPDATE reminders SET status = 'triggered' WHERE id = ?`, [reminder.id]);
      }

      logger.info({ id: reminder.id, jid: reminder.jid }, "Reminder fired");
    } catch (err) {
      logger.error({ err, reminderId: reminder.id }, "Failed to send reminder");
    }
  }
}
