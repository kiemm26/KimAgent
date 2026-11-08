// src/config.ts
// Centralized config loader — reads .env + config/default.json
import dotenv from "dotenv";
dotenv.config({ override: true });
import { readFileSync } from "fs";

import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface AppConfig {
  app: {
    name: string;
    version: string;
    timezone: string;
  };
  debouncer: {
    windowMs: number;
    maxMessages: number;
  };
  react: {
    maxSteps: number;
    contextWindowTokens: number;
    typingDelayMs: { min: number; max: number };
  };
  llm: {
    retryOnRateLimit: boolean;
    cooldownMs: number;
    requestTimeoutMs: number;
    maxRetries: number;
  };
  crystallization: {
    enabled: boolean;
    minSteps: number;
  };
  scheduler: {
    reminderCheckCron: string;
    walCheckpointCron: string;
    dbBackupCron: string;
  };
}

function loadDefaultConfig(): AppConfig {
  const configPath = join(__dirname, "..", "config", "default.json");
  return JSON.parse(readFileSync(configPath, "utf8")) as AppConfig;
}

function loadPrompt(name: string): string {
  const promptPath = join(__dirname, "..", "config", "prompts", `${name}.md`);
  return readFileSync(promptPath, "utf8");
}

// --- Singleton ---
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadDefaultConfig();
    // Allow env overrides for key numeric values
    if (process.env["DEBOUNCE_WINDOW_MS"]) {
      _config.debouncer.windowMs = parseInt(process.env["DEBOUNCE_WINDOW_MS"], 10);
    }
    if (process.env["REACT_MAX_STEPS"]) {
      _config.react.maxSteps = parseInt(process.env["REACT_MAX_STEPS"], 10);
    }
  }
  return _config;
}

export const env = {
  // Server
  PORT: parseInt(process.env["PORT"] ?? "4000", 10),
  NODE_ENV: process.env["NODE_ENV"] ?? "development",
  WEBHOOK_SECRET: process.env["WEBHOOK_SECRET"] ?? "",

  // WAHA
  WAHA_BASE_URL: process.env["WAHA_BASE_URL"] ?? "http://localhost:3000",
  WAHA_API_KEY: process.env["WAHA_API_KEY"] ?? "",
  WAHA_SESSION: process.env["WAHA_SESSION"] ?? "default",

  // Owner
  OWNER_JID: process.env["OWNER_JID"] ?? "",

  // LLM Keys (parse comma-separated list)
  GEMINI_KEYS: (process.env["GEMINI_KEYS"] ?? "").split(",").map((k) => k.trim()).filter(Boolean),
  GEMINI_MODEL: process.env["GEMINI_MODEL"] ?? "gemini-2.5-flash-preview-05-20",
  GEMINI_FALLBACK_MODEL: process.env["GEMINI_FALLBACK_MODEL"] ?? "gemini-1.5-flash",

  OPENROUTER_API_KEY: process.env["OPENROUTER_API_KEY"] ?? "",
  OPENROUTER_MODEL: process.env["OPENROUTER_MODEL"] ?? "google/gemini-flash-1.5",

  // Python Runner
  PYTHON_RUNNER_URL: process.env["PYTHON_RUNNER_URL"] ?? "http://localhost:8000",
  PYTHON_RUNNER_SECRET: process.env["PYTHON_RUNNER_SECRET"] ?? "",
  PYTHON_EXEC_TIMEOUT_MS: parseInt(process.env["PYTHON_EXEC_TIMEOUT_MS"] ?? "10000", 10),

  // DB
  DB_PATH: process.env["DB_PATH"] ?? "./data/db/kim.db",
} as const;

export const prompts = {
  system: loadPrompt("system"),
  antiHallucination: loadPrompt("anti-hallucination"),
  crystallization: loadPrompt("crystallization"),
};
