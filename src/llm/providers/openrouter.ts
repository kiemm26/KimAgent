// src/llm/providers/openrouter.ts
// OpenRouter fallback LLM adapter (OpenAI-compatible API)
import axios from "axios";
import { logger } from "../../logger.js";
import type { ChatMessage, ToolDefinition } from "../../types.js";

export interface OpenRouterCallParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}

export interface OpenRouterCallResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tokensUsed: number;
  finishReason: string;
}

export async function callOpenRouter(
  params: OpenRouterCallParams
): Promise<OpenRouterCallResult> {
  const { apiKey, model, systemPrompt, messages, tools = [], maxTokens = 8192 } = params;

  const orMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === "model" ? "assistant" : m.role,
      content: m.content,
    })),
  ];

  const body: Record<string, unknown> = {
    model,
    messages: orMessages,
    max_tokens: maxTokens,
    temperature: 0.7,
  };

  if (tools.length > 0) {
    body["tools"] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    body,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://kim-agent.local",
        "X-Title": "kim-agent",
      },
      timeout: 30_000,
    }
  );

  const data = response.data as {
    choices: Array<{
      message: {
        content?: string;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string;
    }>;
    usage: { total_tokens: number };
  };

  const choice = data.choices[0];
  if (!choice) throw new Error("OpenRouter: no choice in response");

  const toolCalls: OpenRouterCallResult["toolCalls"] = [];
  for (const tc of choice.message.tool_calls ?? []) {
    try {
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      });
    } catch {
      logger.warn({ raw: tc.function.arguments }, "OpenRouter: failed to parse tool call args");
    }
  }

  logger.debug(
    {
      model,
      tokens: data.usage.total_tokens,
      finishReason: choice.finish_reason,
      toolCalls: toolCalls.length,
    },
    "OpenRouter: response received"
  );

  return {
    content: choice.message.content ?? "",
    toolCalls,
    tokensUsed: data.usage.total_tokens,
    finishReason: choice.finish_reason,
  };
}
