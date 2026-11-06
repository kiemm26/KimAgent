// src/core/react-loop.ts
// ReAct Reasoning Loop — Thought → Action → Observation cycle (max 5 steps)
import { getRotator } from "../llm/rotator.js";
import { callGemini } from "../llm/providers/gemini.js";
import { callOpenRouter } from "../llm/providers/openrouter.js";
import { getToolDefinitions, executeTool } from "../tools/index.js";
import { prompts, getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { ChatMessage, ReActResult, ReActStep } from "../types.js";

const AXIOS_429_STATUS = 429;

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

  // Build messages for LLM
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  for (let step = 0; step < maxSteps; step++) {
    logger.debug({ step, jid }, "ReAct: starting step");

    // Get a healthy API key
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

    try {
      let response: { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; tokensUsed: number; finishReason: string };

      if (keyEntry.provider === "gemini") {
        response = await callGemini({
          apiKey: keyEntry.key,
          model: keyEntry.model,
          systemPrompt,
          messages,
          tools,
        });
      } else {
        response = await callOpenRouter({
          apiKey: keyEntry.key,
          model: keyEntry.model,
          systemPrompt,
          messages,
          tools,
        });
      }

      totalTokens += response.tokensUsed;
      getRotator().markSuccess(keyEntry.key);

      // No tool calls → Final Answer
      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.info({ jid, step, totalTokens }, "ReAct: final answer reached");
        steps.push({ thought: response.content });
        return {
          answer: response.content,
          steps,
          tokensUsed: totalTokens,
          keyUsed: usedKey,
          model: usedModel,
        };
      }

      // Process tool calls
      const toolResults: string[] = [];
      for (const tc of response.toolCalls) {
        logger.info({ jid, step, tool: tc.name, args: tc.arguments }, "ReAct: executing tool");
        const { result, isError } = await executeTool(tc.name, tc.arguments);
        toolResults.push(`[Tool: ${tc.name}]\n${result}`);

        steps.push({
          thought: response.content,
          action: tc,
          observation: { toolCallId: tc.id, content: result, isError },
        });
      }

      // Add model's response + tool results to messages for next step
      messages.push({ role: "model", content: response.content, toolCalls: response.toolCalls });
      messages.push({ role: "tool", content: toolResults.join("\n\n") });

    } catch (err: unknown) {
      const error = err as { response?: { status?: number; headers?: { "retry-after"?: string } }; message?: string };
      const status = error.response?.status;

      if (status === AXIOS_429_STATUS) {
        const retryAfterSec = parseInt(error.response?.headers?.["retry-after"] ?? "60", 10);
        getRotator().markRateLimited(keyEntry.key, retryAfterSec * 1000);
        logger.warn({ jid, step, retryAfterSec }, "ReAct: 429 rate limit, rotating key");
        // Retry this step with a different key (don't increment step counter)
        step--;
        continue;
      }

      getRotator().markError(keyEntry.key);
      logger.error({ jid, step, err }, "ReAct: LLM call failed");

      return {
        answer: `❌ Terjadi kesalahan saat memproses: ${error.message ?? "Unknown error"}. Silakan coba lagi.`,
        steps,
        tokensUsed: totalTokens,
        keyUsed: usedKey,
        model: usedModel,
      };
    }
  }

  // Max steps reached — return partial result
  logger.warn({ jid, maxSteps }, "ReAct: max steps reached, returning partial answer");
  return {
    answer: `⚠️ Respon membutuhkan lebih dari ${maxSteps} langkah. Berikut hasil yang sudah terkumpul:\n\n` +
      steps.map((s, i) => `Step ${i + 1}: ${s.observation?.content ?? s.thought}`).join("\n"),
    steps,
    tokensUsed: totalTokens,
    keyUsed: usedKey,
    model: usedModel,
  };
}
