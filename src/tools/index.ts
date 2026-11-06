// src/tools/index.ts
// Tool Registry — defines available tools and dispatches execution
import type { ToolDefinition, ToolHandler } from "../types.js";
import { dbToolHandlers, dbToolDefinitions } from "./db-tools.js";
import { computeToolHandlers, computeToolDefinitions } from "./compute.js";
import { reminderToolHandlers, reminderToolDefinitions } from "./reminders.js";
import { logger } from "../logger.js";

// ----------------------------------------------------------------
// Registry
// ----------------------------------------------------------------

const handlers = new Map<string, ToolHandler>();
const definitions: ToolDefinition[] = [];

function registerTools(defs: ToolDefinition[], hdlrs: Record<string, ToolHandler>): void {
  for (const def of defs) {
    definitions.push(def);
    const handler = hdlrs[def.name];
    if (!handler) {
      logger.warn({ toolName: def.name }, "Tool has no handler registered");
      continue;
    }
    handlers.set(def.name, handler);
  }
}

// Register all tool groups
registerTools(dbToolDefinitions, dbToolHandlers);
registerTools(computeToolDefinitions, computeToolHandlers);
registerTools(reminderToolDefinitions, reminderToolHandlers);

export function getToolDefinitions(): ToolDefinition[] {
  return definitions;
}

/**
 * Execute a tool by name and return its string result.
 * Never throws — wraps errors in a formatted string.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ result: string; isError: boolean }> {
  const handler = handlers.get(name);

  if (!handler) {
    return {
      result: `❌ Tool "${name}" is not registered. Available: ${[...handlers.keys()].join(", ")}`,
      isError: true,
    };
  }

  try {
    logger.debug({ tool: name, args }, "Executing tool");
    const result = await handler(args);
    logger.debug({ tool: name, resultPreview: String(result).slice(0, 100) }, "Tool executed");
    return { result: String(result), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ tool: name, args, err }, "Tool execution error");
    return {
      result: `❌ Tool "${name}" failed: ${message}`,
      isError: true,
    };
  }
}
