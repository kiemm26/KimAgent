// src/core/router.ts
// Message router — decides fast command vs ReAct LLM path
import { handleCommand } from "./commands.js";
import { runReActLoop } from "./react-loop.js";
import { getWahaClient } from "../gateway/waha.js";
import { dbQuery, dbRun } from "../db/sqlite.js";
import { env } from "../config.js";
import { logger } from "../logger.js";
import { crystallizeInBackground } from "../memory/crystallize.js";
import type { DebouncedMessage, ChatMessage, ReActResult } from "../types.js";

const MAX_HISTORY = 20;

export async function routeMessage(msg: DebouncedMessage): Promise<void> {
  const { jid, mergedText } = msg;
  const waha = getWahaClient();

  // Security: only process messages from OWNER_JID
  if (env.OWNER_JID && jid !== env.OWNER_JID) {
    logger.warn({ jid }, "Ignoring message from non-owner JID");
    return;
  }

  if (!mergedText.trim()) {
    logger.debug({ jid }, "Skipping empty merged message");
    return;
  }

  logger.info({ jid, preview: mergedText.slice(0, 80) }, "Routing message");

  // ── Path 1: Deterministic Fast Command ──────────────────────────
  const cmdResult = await handleCommand(mergedText, jid);
  if (cmdResult.handled && cmdResult.response) {
    await waha.sendWithTypingEffect(jid, cmdResult.response);
    return;
  }

  // ── Path 2: ReAct LLM Agent ─────────────────────────────────────
  // Load conversation history
  const history = loadHistory(jid);

  // Send typing indicator while processing
  await waha.startTyping({ chatId: jid });

  let result: ReActResult;
  try {
    result = await runReActLoop(mergedText, history, jid);
  } finally {
    await waha.stopTyping({ chatId: jid });
  }

  // Send the answer
  await waha.sendText({ chatId: jid, text: result.answer });

  // Persist conversation turn to DB
  persistMessages(jid, mergedText, result.answer);

  // Background crystallization (non-blocking)
  if (result.steps.length >= 2) {
    queueMicrotask(() => {
      crystallizeInBackground(jid, mergedText, result).catch((err) =>
        logger.error({ err }, "Crystallization background task failed")
      );
    });
  }
}

function loadHistory(jid: string): ChatMessage[] {
  const rows = dbQuery<{ role: string; content: string }>(
    `SELECT role, content FROM messages WHERE jid = ? ORDER BY created_at DESC LIMIT ?`,
    [jid, MAX_HISTORY]
  );
  return rows.reverse().map((r) => ({
    role: r.role as "user" | "model",
    content: r.content,
  }));
}

function persistMessages(jid: string, userMsg: string, assistantMsg: string): void {
  const now = Math.floor(Date.now() / 1000);
  dbRun(
    `INSERT INTO messages (jid, role, content, created_at) VALUES (?, 'user', ?, ?)`,
    [jid, userMsg, now]
  );
  dbRun(
    `INSERT INTO messages (jid, role, content, created_at) VALUES (?, 'assistant', ?, ?)`,
    [jid, assistantMsg, now]
  );
}
