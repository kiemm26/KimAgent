// src/llm/rotator.ts
// Multi-Key API Rotator with round-robin, 429 backoff, and fallback
import { env, getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { ApiKeyEntry } from "../types.js";

export class LLMRotator {
  private readonly keys: ApiKeyEntry[] = [];
  private roundRobinIndex = 0;

  constructor() {
    this.initializeKeys();
  }

  private initializeKeys(): void {
    // Add Gemini keys
    for (const key of env.GEMINI_KEYS) {
      this.keys.push({
        key,
        provider: "gemini",
        model: env.GEMINI_MODEL,
        cooldownUntil: 0,
        requestCount: 0,
        errorCount: 0,
        lastUsedAt: 0,
      });
    }

    // Add OpenRouter as fallback
    if (env.OPENROUTER_API_KEY) {
      this.keys.push({
        key: env.OPENROUTER_API_KEY,
        provider: "openrouter",
        model: env.OPENROUTER_MODEL,
        cooldownUntil: 0,
        requestCount: 0,
        errorCount: 0,
        lastUsedAt: 0,
      });
    }

    logger.info(
      {
        total: this.keys.length,
        gemini: this.keys.filter((k) => k.provider === "gemini").length,
        openrouter: this.keys.filter((k) => k.provider === "openrouter").length,
      },
      "LLMRotator: key pool initialized"
    );
  }

  /**
   * Get the next healthy API key (round-robin with cooldown skip).
   * Returns null if all keys are on cooldown.
   */
  getNextKey(): ApiKeyEntry | null {
    const now = Date.now();
    const total = this.keys.length;

    // Try each key starting from current round-robin index
    for (let attempt = 0; attempt < total; attempt++) {
      const idx = (this.roundRobinIndex + attempt) % total;
      const entry = this.keys[idx];

      if (!entry) continue;

      if (entry.cooldownUntil <= now) {
        // Advance index for next call
        this.roundRobinIndex = (idx + 1) % total;
        entry.lastUsedAt = now;
        entry.requestCount++;
        return entry;
      }
    }

    // All keys on cooldown — find the one that recovers soonest
    const soonest = this.keys.reduce((a, b) =>
      a.cooldownUntil < b.cooldownUntil ? a : b
    );

    const waitMs = soonest.cooldownUntil - now;
    logger.warn({ waitMs }, "LLMRotator: ALL keys on cooldown");
    return null;
  }

  /**
   * Mark a key as rate-limited and put it in cooldown.
   */
  markRateLimited(key: string, retryAfterMs?: number): void {
    const cfg = getConfig();
    const entry = this.keys.find((k) => k.key === key);
    if (!entry) return;

    const cooldownMs = retryAfterMs ?? cfg.llm.cooldownMs;
    entry.cooldownUntil = Date.now() + cooldownMs;
    entry.errorCount++;

    logger.warn(
      {
        provider: entry.provider,
        model: entry.model,
        cooldownMs,
        errorCount: entry.errorCount,
      },
      "LLMRotator: key marked as rate-limited"
    );
  }

  /**
   * Mark a key as errored (non-429 error — shorter cooldown).
   */
  markError(key: string): void {
    const entry = this.keys.find((k) => k.key === key);
    if (!entry) return;

    entry.cooldownUntil = Date.now() + 10_000; // 10s cooldown for generic errors
    entry.errorCount++;

    logger.warn(
      { provider: entry.provider, errorCount: entry.errorCount },
      "LLMRotator: key marked as errored (short cooldown)"
    );
  }

  /**
   * Reset a key back to healthy state (called on successful response).
   */
  markSuccess(key: string): void {
    const entry = this.keys.find((k) => k.key === key);
    if (!entry) return;
    entry.cooldownUntil = 0;
  }

  /**
   * Health status report for the #health command.
   */
  getHealthReport(): {
    total: number;
    healthy: number;
    onCooldown: number;
    keys: Array<{
      provider: string;
      model: string;
      healthy: boolean;
      requestCount: number;
      errorCount: number;
    }>;
  } {
    const now = Date.now();
    const report = this.keys.map((k) => ({
      provider: k.provider,
      model: k.model,
      healthy: k.cooldownUntil <= now,
      requestCount: k.requestCount,
      errorCount: k.errorCount,
    }));

    return {
      total: this.keys.length,
      healthy: report.filter((k) => k.healthy).length,
      onCooldown: report.filter((k) => !k.healthy).length,
      keys: report,
    };
  }

  /**
   * Wait until at least one key is available (with timeout).
   */
  async waitForAvailableKey(timeoutMs = 30_000): Promise<ApiKeyEntry | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const key = this.getNextKey();
      if (key) return key;
      await sleep(1_000);
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton
let _rotator: LLMRotator | null = null;
export function getRotator(): LLMRotator {
  if (!_rotator) _rotator = new LLMRotator();
  return _rotator;
}
