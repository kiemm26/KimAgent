// src/memory/context.ts
// Sliding context window manager — prunes old messages to fit token budget
import type { ChatMessage } from "../types.js";
import { getConfig } from "../config.js";

// Rough token estimator (1 token ≈ 4 characters for English/mix)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Prune the conversation history to fit within the configured token budget.
 * Always preserves at minimum the last 2 messages.
 */
export function pruneContext(messages: ChatMessage[]): ChatMessage[] {
  const config = getConfig();
  const budget = config.react.contextWindowTokens;

  if (messages.length <= 2) return messages;

  let total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (total <= budget) return messages;

  // Remove oldest messages first (keep at least last 2)
  const pruned = [...messages];
  while (total > budget && pruned.length > 2) {
    const removed = pruned.shift();
    if (removed) {
      total -= estimateTokens(removed.content);
    }
  }

  return pruned;
}

/**
 * Build the system + history context string for display/debugging.
 */
export function summarizeContext(messages: ChatMessage[]): string {
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  return `Context: ${messages.length} messages, ~${totalTokens} tokens`;
}
