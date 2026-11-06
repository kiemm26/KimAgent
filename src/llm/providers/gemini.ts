// src/llm/providers/gemini.ts
// Google Gemini API adapter using @google/generative-ai SDK
import { GoogleGenerativeAI, type GenerateContentRequest } from "@google/generative-ai";
import { env } from "../../config.js";
import { logger } from "../../logger.js";
import type { ChatMessage, ToolDefinition } from "../../types.js";

export interface GeminiCallParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}

export interface GeminiCallResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tokensUsed: number;
  finishReason: string;
}

/**
 * Call Gemini with the provided params and return structured result.
 * Throws on API error so the rotator can handle retries.
 */
export async function callGemini(params: GeminiCallParams): Promise<GeminiCallResult> {
  const { apiKey, model, systemPrompt, messages, tools = [], maxTokens = 8192 } = params;

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
    },
    ...(tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters as Parameters<typeof geminiModel.generateContent>[0] extends GenerateContentRequest ? never : never,
              })),
            },
          ],
        }
      : {}),
  });

  // Convert ChatMessage[] to Gemini history format
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("No messages provided to Gemini");
  }

  const chat = geminiModel.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  const response = result.response;

  const tokenCount = response.usageMetadata?.totalTokenCount ?? 0;
  const finishReason = response.candidates?.[0]?.finishReason ?? "STOP";

  // Extract tool calls
  const toolCallsRaw = response.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: GeminiCallResult["toolCalls"] = [];

  for (const part of toolCallsRaw) {
    if ("functionCall" in part && part.functionCall) {
      toolCalls.push({
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: part.functionCall.name,
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }

  const textContent = response.text();

  logger.debug(
    { model, tokens: tokenCount, finishReason, toolCalls: toolCalls.length },
    "Gemini: response received"
  );

  return {
    content: textContent,
    toolCalls,
    tokensUsed: tokenCount,
    finishReason,
  };
}
