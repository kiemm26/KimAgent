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

function extractDigits(str: string): string {
  return str.replace(/[^0-9]/g, "");
}

export async function routeMessage(msg: DebouncedMessage): Promise<void> {
  const { jid, mergedText } = msg;
  const waha = getWahaClient();

  console.log(`\n🤖 [ROUTER] Processing message from: ${jid} | "${mergedText}"`);

  // Security: only process messages from OWNER_JID if configured
  const configuredOwner = (process.env["OWNER_JID"] ?? env.OWNER_JID ?? "").trim();
  const allowAll = !configuredOwner || configuredOwner === "*" || configuredOwner.toLowerCase() === "all";

  if (!allowAll) {
    const ownerDigits = extractDigits(configuredOwner);
    const senderDigits = extractDigits(jid);

    if (ownerDigits && senderDigits !== ownerDigits) {
      console.log(`⚠️  [ROUTER BLOCKED] Sender digits (${senderDigits}) do not match OWNER_JID digits (${ownerDigits})!`);
      logger.warn(
        { senderJid: jid, senderDigits, configuredOwner, ownerDigits },
        "Ignoring message from non-owner. Set OWNER_JID=* in .env to allow all."
      );
      return;
    }
  }


  if (!mergedText.trim()) {
    logger.debug({ jid }, "Skipping empty merged message");
    return;
  }

  logger.info({ jid, preview: mergedText.slice(0, 80) }, "Routing message to execution");

  // ── Path 1: Deterministic Fast Command ──────────────────────────
  const cmdResult = await handleCommand(mergedText, jid);
  if (cmdResult.handled && cmdResult.response) {
    console.log(`⚡ [FAST CMD RESPONSE] to: ${jid}\n${cmdResult.response}`);
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
