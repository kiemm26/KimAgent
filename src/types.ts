// src/types.ts
// Shared TypeScript type definitions for kim-agent

// ----------------------------------------------------------------
// WAHA / WhatsApp types
// ----------------------------------------------------------------

export interface WahaWebhookPayload {
  event: string;
  session: string;
  payload: WahaMessagePayload | WahaSessionPayload;
  metadata?: Record<string, unknown>;
  me?: { id: string; pushName: string };
}

export interface WahaMessagePayload {
  id: string;
  timestamp: number;
  from: string;
  fromMe: boolean;
  to: string;
  body: string;
  hasMedia: boolean;
  mediaUrl?: string;
  mimeType?: string;
  _data?: Record<string, unknown>;
}

export interface WahaSessionPayload {
  status: string;
  name: string;
}

// ----------------------------------------------------------------
// Debouncer types
// ----------------------------------------------------------------

export interface DebouncedMessage {
  jid: string;
  messages: WahaMessagePayload[];
  mergedText: string;
  firstTimestamp: number;
}

// ----------------------------------------------------------------
// LLM / ReAct types
// ----------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "model" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface ReActStep {
  thought: string;
  action?: ToolCall;
  observation?: ToolResult;
}

export interface ReActResult {
  answer: string;
  steps: ReActStep[];
  tokensUsed: number;
  keyUsed: string;
  model: string;
}

// ----------------------------------------------------------------
// Tool types
// ----------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameterSchema>;
    required: string[];
  };
}

export interface ToolParameterSchema {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: ToolParameterSchema;
}

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<string> | string;

// ----------------------------------------------------------------
// DB row types
// ----------------------------------------------------------------

export interface TodoRow {
  id: number;
  jid: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_at: number | null;
  tags: string; // JSON string
  created_at: number;
  updated_at: number;
  done_at: number | null;
}

export interface NoteRow {
  id: number;
  jid: string;
  title: string;
  content: string;
  tags: string; // JSON string
  pinned: number;
  created_at: number;
  updated_at: number;
}

export interface ReminderRow {
  id: number;
  jid: string;
  title: string;
  message: string;
  remind_at: number;
  recurrence: string | null;
  status: "active" | "triggered" | "cancelled";
  created_at: number;
}

export interface SkillRow {
  id: string;
  title: string;
  description: string;
  trigger_patterns: string; // JSON string
  tools_used: string; // JSON string
  content: string;
  usage_count: number;
  success_rate: number;
  created_at: number;
  updated_at: number;
}

// ----------------------------------------------------------------
// LLM Rotator types
// ----------------------------------------------------------------

export interface ApiKeyEntry {
  key: string;
  provider: "gemini" | "openrouter";
  model: string;
  cooldownUntil: number;      // Unix ms timestamp (0 = healthy)
  requestCount: number;
  errorCount: number;
  lastUsedAt: number;
}
