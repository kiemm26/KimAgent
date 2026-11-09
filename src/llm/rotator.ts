// src/llm/rotator.ts
// Multi-Key API Rotator with round-robin, 429 backoff, and fallback
import { env, getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { ApiKeyEntry } from "../types.js";

/** Placeholder patterns that should never be used as real API keys */
const PLACEHOLDER_PATTERNS = [
  /^your_/i,
  /^changeme$/i,
  /^<.*>$/,
  /^example/i,
  /^xxx/i,
  /^test$/i,
];

function isPlaceholderKey(key: string): boolean {
  if (!key || key.trim().length === 0) return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(key.trim()));
}

export class LLMRotator {
  /** Primary pool: Gemini keys — used first via round-robin */
  private readonly primaryKeys: ApiKeyEntry[] = [];
  /** Fallback pool: OpenRouter — only used when ALL primary keys are unavailable */
  private readonly fallbackKeys: ApiKeyEntry[] = [];
  private primaryRoundRobinIndex = 0;

  constructor() {
    this.initializeKeys();
  }

  private initializeKeys(): void {
    for (const rawKey of env.GEMINI_KEYS) {
      const key = rawKey.trim();
      if (isPlaceholderKey(key)) {
        logger.warn({ keyPreview: key.slice(0, 10) }, "LLMRotator: skipping placeholder/empty Gemini key");
        continue;
      }
      this.primaryKeys.push({
        key,
        provider: "gemini",
        model: env.GEMINI_MODEL,
        cooldownUntil: 0,
        requestCount: 0,
        errorCount: 0,
        lastUsedAt: 0,
      });
    }

    const orKey = env.OPENROUTER_API_KEY?.trim();
    if (orKey && !isPlaceholderKey(orKey)) {
      this.fallbackKeys.push({
        key: orKey,
        provider: "openrouter",
        model: env.OPENROUTER_MODEL,
        cooldownUntil: 0,
        requestCount: 0,
        errorCount: 0,
        lastUsedAt: 0,
      });
    }

    const total = this.primaryKeys.length + this.fallbackKeys.length;
    if (total === 0) {
      logger.error("LLMRotator: NO valid API keys found! Check GEMINI_KEYS in .env");
    }

    logger.info(
      { total, gemini: this.primaryKeys.length, openrouter: this.fallbackKeys.length },
      "LLMRotator: key pool initialized"
    );
  }

  /**
   * Get the next healthy primary (Gemini) key via round-robin.
   * Falls back to OpenRouter only if no primary key is available.
   * Returns null if ALL keys (primary + fallback) are on cooldown/blacklisted.
   */
  getNextKey(): ApiKeyEntry | null {
    const now = Date.now();

    // 1. Try primary keys (Gemini) round-robin
    const primaryTotal = this.primaryKeys.length;
    for (let attempt = 0; attempt < primaryTotal; attempt++) {
      const idx = (this.primaryRoundRobinIndex + attempt) % primaryTotal;
      const entry = this.primaryKeys[idx];
      if (!entry) continue;

      if (entry.cooldownUntil <= now) {
        this.primaryRoundRobinIndex = (idx + 1) % primaryTotal;
        entry.lastUsedAt = now;
        entry.requestCount++;
        return entry;
      }
    }

    // 2. All primary keys are on cooldown — try fallback keys
    for (const entry of this.fallbackKeys) {
      if (entry.cooldownUntil <= now) {
        entry.lastUsedAt = now;
        entry.requestCount++;
        logger.info({ provider: entry.provider }, "LLMRotator: using fallback key");
        return entry;
      }
    }

    // 3. Everything on cooldown — find soonest recovery
    const allKeys = [...this.primaryKeys, ...this.fallbackKeys];
    if (allKeys.length === 0) return null;

    const soonest = allKeys.reduce((a, b) =>
      a.cooldownUntil < b.cooldownUntil ? a : b
    );
    const waitMs = soonest.cooldownUntil - now;
    logger.warn({ waitMs }, "LLMRotator: ALL keys on cooldown");
    return null;
  }

  /**
   * Mark a key as rate-limited (HTTP 429) — apply configured cooldown.
   */
  markRateLimited(key: string, retryAfterMs?: number): void {
    const cfg = getConfig();
    const entry = this.findEntry(key);
    if (!entry) return;

    const cooldownMs = retryAfterMs ?? cfg.llm.cooldownMs;
    entry.cooldownUntil = Date.now() + cooldownMs;
    entry.errorCount++;

    logger.warn(
      { provider: entry.provider, model: entry.model, cooldownMs, errorCount: entry.errorCount },
      "LLMRotator: key marked as rate-limited (429)"
    );
  }

  /**
   * Mark a key as temporarily errored (non-429, non-401 — short cooldown).
   */
  markError(key: string): void {
    const entry = this.findEntry(key);
    if (!entry) return;

    entry.cooldownUntil = Date.now() + 15_000; // 15s cooldown for transient errors
    entry.errorCount++;

    logger.warn(
      { provider: entry.provider, errorCount: entry.errorCount },
      "LLMRotator: key marked as errored (15s cooldown)"
    );
  }

  /**
   * Permanently blacklist a key this session (HTTP 401 Unauthorized).
   * Sets cooldown to far future so it's never selected again.
   */
  markUnauthorized(key: string): void {
    const entry = this.findEntry(key);
    if (!entry) return;

    // Effectively blacklist: cooldown until year 2099
    entry.cooldownUntil = Date.now() + 999_999_999_999;
    entry.errorCount++;

    logger.error(
      { provider: entry.provider, model: entry.model },
      "LLMRotator: key BLACKLISTED (401 Unauthorized) — will not be retried this session"
    );
  }

  /**
   * Reset a key back to healthy state (called on successful response).
   */
  markSuccess(key: string): void {
    const entry = this.findEntry(key);
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
    const allKeys = [...this.primaryKeys, ...this.fallbackKeys];
    const report = allKeys.map((k) => ({
      provider: k.provider,
      model: k.model,
      healthy: k.cooldownUntil <= now,
      requestCount: k.requestCount,
      errorCount: k.errorCount,
    }));

    return {
      total: allKeys.length,
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

  private findEntry(key: string): ApiKeyEntry | undefined {
    return (
      this.primaryKeys.find((k) => k.key === key) ??
      this.fallbackKeys.find((k) => k.key === key)
    );
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
