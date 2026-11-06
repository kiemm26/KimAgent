// src/gateway/debouncer.ts
// FIFO Burst Debouncer — groups rapid messages from the same JID
// within a configurable time window before forwarding to the router.
import type { WahaMessagePayload, DebouncedMessage } from "../types.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";

type FlushCallback = (msg: DebouncedMessage) => void;

interface BufferEntry {
  messages: WahaMessagePayload[];
  timer: NodeJS.Timeout;
  firstTimestamp: number;
}

export class BurstDebouncer {
  private readonly buffer = new Map<string, BufferEntry>();
  private readonly windowMs: number;
  private readonly maxMessages: number;
  private readonly onFlush: FlushCallback;

  constructor(onFlush: FlushCallback) {
    const cfg = getConfig();
    this.windowMs = cfg.debouncer.windowMs;
    this.maxMessages = cfg.debouncer.maxMessages;
    this.onFlush = onFlush;
    logger.info(
      { windowMs: this.windowMs, maxMessages: this.maxMessages },
      "BurstDebouncer initialized"
    );
  }

  /**
   * Push an incoming message into the debounce buffer for the given JID.
   * The buffer is flushed after `windowMs` of inactivity, or immediately
   * when `maxMessages` is reached.
   */
  push(jid: string, message: WahaMessagePayload): void {
    const existing = this.buffer.get(jid);

    if (existing) {
      // Reset the timer & append the message
      clearTimeout(existing.timer);
      existing.messages.push(message);

      // Hard flush if max messages reached
      if (existing.messages.length >= this.maxMessages) {
        logger.debug({ jid, count: existing.messages.length }, "Debouncer: max messages reached, flushing now");
        this.flush(jid);
        return;
      }

      // Restart debounce window
      existing.timer = this.createTimer(jid);
    } else {
      // First message in this window
      this.buffer.set(jid, {
        messages: [message],
        firstTimestamp: Date.now(),
        timer: this.createTimer(jid),
      });
    }

    logger.debug({ jid, buffered: this.buffer.get(jid)?.messages.length }, "Debouncer: buffered message");
  }

  /**
   * Flush the buffer for a given JID — merges text and fires the callback.
   */
  private flush(jid: string): void {
    const entry = this.buffer.get(jid);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.buffer.delete(jid);

    const mergedText = entry.messages
      .map((m) => m.body?.trim())
      .filter(Boolean)
      .join("\n");

    logger.info(
      { jid, messageCount: entry.messages.length, preview: mergedText.slice(0, 60) },
      "Debouncer: flushing messages"
    );

    const debounced: DebouncedMessage = {
      jid,
      messages: entry.messages,
      mergedText,
      firstTimestamp: entry.firstTimestamp,
    };

    this.onFlush(debounced);
  }

  private createTimer(jid: string): NodeJS.Timeout {
    return setTimeout(() => {
      logger.debug({ jid }, "Debouncer: window expired, flushing");
      this.flush(jid);
    }, this.windowMs);
  }

  /**
   * Force-flush all pending buffers (used during graceful shutdown).
   */
  flushAll(): void {
    for (const jid of this.buffer.keys()) {
      this.flush(jid);
    }
  }

  get pendingCount(): number {
    return this.buffer.size;
  }
}
