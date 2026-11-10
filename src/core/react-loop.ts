// src/core/react-loop.ts
// ReAct Reasoning Loop — Thought → Action → Observation cycle (max 5 steps)
import { getRotator } from "../llm/rotator.js";
import { callGemini } from "../llm/providers/gemini.js";
import { callOpenRouter } from "../llm/providers/openrouter.js";
import { getToolDefinitions, executeTool } from "../tools/index.js";
import { prompts, getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { ChatMessage, ReActResult, ReActStep } from "../types.js";

const HTTP_429 = 429;
const HTTP_401 = 401;
const HTTP_403 = 403;
const HTTP_404 = 404;
const HTTP_503 = 503;

/** Max retries on rotatable errors (401/404/503) before giving up */
const MAX_KEY_RETRIES = 6;

export async function runReActLoop(
  userMessage: string,
  history: ChatMessage[],
  jid: string
): Promise<ReActResult> {
  const config = getConfig();
  const maxSteps = config.react.maxSteps;
  const tools = getToolDefinitions();
  const systemPrompt = `${prompts.system}\n\n${prompts.antiHallucination}`;
  const steps: ReActStep[] = [];
  let totalTokens = 0;
  let usedKey = "";
  let usedModel = "";

  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  for (let step = 0; step < maxSteps; step++) {
    logger.debug({ step, jid }, "ReAct: starting step");

    const keyEntry = await getRotator().waitForAvailableKey(25_000);
    if (!keyEntry) {
      return {
        answer: "⚠️ Semua API key sedang dalam cooldown. Coba lagi dalam beberapa menit.",
        steps,
        tokensUsed: totalTokens,
        keyUsed: "none",
        model: "none",
      };
    }
    usedKey = keyEntry.key;
    usedModel = keyEntry.model;

    const isFinalStep = step === maxSteps - 1;
    // On the final step, remove tools to force a final text answer
    const currentTools = isFinalStep ? [] : tools;
    if (isFinalStep && steps.length > 0) {
      messages.push({
        role: "user",
        content: "Sajikan kesimpulan dan jawaban final terbaik berdasarkan semua data yang sudah kamu kumpulkan di atas secara lengkap dan rapi.",
      });
    }

    try {
      let response: { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; tokensUsed: number; finishReason: string };

      if (keyEntry.provider === "gemini") {
        response = await callGemini({ apiKey: keyEntry.key, model: keyEntry.model, systemPrompt, messages, tools: currentTools });
      } else {
        response = await callOpenRouter({ apiKey: keyEntry.key, model: keyEntry.model, systemPrompt, messages, tools: currentTools });
      }

      totalTokens += response.tokensUsed;
      getRotator().markSuccess(keyEntry.key, keyEntry.model);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.info({ jid, step, totalTokens }, "ReAct: final answer reached");
        steps.push({ thought: response.content });
        return { answer: response.content, steps, tokensUsed: totalTokens, keyUsed: usedKey, model: usedModel };
      }

      const toolResults: string[] = [];
      for (const tc of response.toolCalls) {
        logger.info({ jid, step, tool: tc.name, args: tc.arguments }, "ReAct: executing tool");
        const { result, isError } = await executeTool(tc.name, tc.arguments);
        toolResults.push(`[Tool: ${tc.name}]\n${result}`);
        steps.push({ thought: response.content, action: tc, observation: { toolCallId: tc.id, content: result, isError } });
      }

      messages.push({ role: "model", content: response.content, toolCalls: response.toolCalls });
      messages.push({ role: "tool", content: toolResults.join("\n\n") });

    } catch (err: unknown) {
      const error = err as {
        status?: number;
        statusCode?: number;
        response?: { status?: number; headers?: { "retry-after"?: string } };
        message?: string;
      };

      // Extract HTTP status from axios response or parse GoogleGenerativeAI Error message string
      const rawMsg = error.message ?? "";
      let status: number | undefined = error.status ?? error.statusCode ?? error.response?.status;

      if (!status) {
        if (
          rawMsg.includes("429") ||
          rawMsg.toLowerCase().includes("resource has been exhausted") ||
          rawMsg.toLowerCase().includes("quota")
        ) {
          status = HTTP_429;
        } else if (rawMsg.includes("401") || rawMsg.includes("403") || rawMsg.toLowerCase().includes("api_key_invalid")) {
          status = HTTP_401;
        } else if (rawMsg.includes("404") || rawMsg.toLowerCase().includes("not found")) {
          status = HTTP_404;
        } else if (rawMsg.includes("503") || rawMsg.toLowerCase().includes("high demand") || rawMsg.toLowerCase().includes("service unavailable")) {
          status = HTTP_503;
        }
      }

      // 429 Rate Limited / Quota Exhausted: cooldown & rotate to next key or model
      if (status === HTTP_429) {
        const retryAfterSec = parseInt(error.response?.headers?.["retry-after"] ?? "60", 10);
        getRotator().markRateLimited(keyEntry.key, keyEntry.model, retryAfterSec * 1000);
        logger.warn({ jid, step, model: keyEntry.model, retryAfterSec }, "ReAct: 429 rate limit/quota, rotating key/model");
        if (step < MAX_KEY_RETRIES) {
          step--;
          continue;
        }
        return {
          answer: "⚠️ Kuota API key / model saat ini sedang penuh. Mohon coba lagi beberapa saat lagi.",
          steps, tokensUsed: totalTokens, keyUsed: usedKey, model: usedModel,
        };
      }

      // 401/403 Unauthorized: blacklist & rotate
      if (status === HTTP_401 || status === HTTP_403) {
        getRotator().markUnauthorized(keyEntry.key);
        logger.warn({ jid, step, status }, "ReAct: auth error, blacklisting key & rotating");
        if (step < MAX_KEY_RETRIES) { step--; continue; }
        return {
          answer: "⚠️ API key tidak valid atau tidak memiliki akses. Mohon periksa konfigurasi key.",
          steps, tokensUsed: totalTokens, keyUsed: usedKey, model: usedModel,
        };
      }

      // 404 Model Not Found: blacklist this model for this key & rotate
      if (status === HTTP_404) {
        getRotator().markRateLimited(keyEntry.key, keyEntry.model, 86_400_000); // 24hr cooldown for non-existent model
        logger.warn({ jid, step, status, model: keyEntry.model }, "ReAct: 404 model not found, rotating to alternative model");
        if (step < MAX_KEY_RETRIES) { step--; continue; }
        return {
          answer: `⚠️ Model *${keyEntry.model}* tidak tersedia. Sistem sedang mencoba beralih ke model lain.`,
          steps, tokensUsed: totalTokens, keyUsed: usedKey, model: usedModel,
        };
      }

      // 503 Service Unavailable / High Demand: short cooldown & rotate
      if (status === HTTP_503) {
        getRotator().markError(keyEntry.key, keyEntry.model);
        logger.warn({ jid, step, model: keyEntry.model }, "ReAct: 503 unavailable / high demand, rotating model/key");
        if (step < MAX_KEY_RETRIES) { step--; continue; }
      }

      // Other errors: log & fail
      getRotator().markError(keyEntry.key, keyEntry.model);
      logger.error({ jid, step, status, err }, "ReAct: LLM call failed");
      return {
        answer: `❌ Terjadi kesalahan saat memproses: ${error.message ?? "Unknown error"}. Silakan coba lagi.`,
        steps, tokensUsed: totalTokens, keyUsed: usedKey, model: usedModel,
      };
    }
  }

  logger.warn({ jid, maxSteps }, "ReAct: max steps reached, returning aggregated observations");
  const observations = steps
    .filter((s) => s.observation?.content)
    .map((s) => s.observation!.content)
    .join("\n\n");

  return {
    answer: observations || "Permintaan telah diproses, namun tidak ada ringkasan teks yang dihasilkan.",
    steps,
    tokensUsed: totalTokens,
    keyUsed: usedKey,
    model: usedModel,
  };
}

