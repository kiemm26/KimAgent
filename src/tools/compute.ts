// src/tools/compute.ts
// Python Runner HTTP client tool — sends computation requests to the sandbox
import axios from "axios";
import { env } from "../config.js";
import { logger } from "../logger.js";
import type { ToolDefinition, ToolHandler } from "../types.js";

async function callRunner(endpoint: string, body: Record<string, unknown>): Promise<string> {
  try {
    const res = await axios.post(`${env.PYTHON_RUNNER_URL}${endpoint}`, body, {
      headers: {
        "Content-Type": "application/json",
        "X-Runner-Secret": env.PYTHON_RUNNER_SECRET,
      },
      timeout: env.PYTHON_EXEC_TIMEOUT_MS + 2000,
    });
    return JSON.stringify(res.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const detail = (err.response?.data as { detail?: string })?.detail ?? err.message;
      throw new Error(`Python runner error (HTTP ${status}): ${detail}`);
    }
    throw err;
  }
}
export async function checkRunnerHealth(): Promise<boolean> {
  try {
    const res = await axios.get(`${env.PYTHON_RUNNER_URL}/health`, { timeout: 3000 });
    return res.status === 200;
  } catch {
    return false;
  }
}


export const computeToolDefinitions: ToolDefinition[] = [
  {
    name: "python_execute",
    description:
      "Execute Python 3.12 code in an isolated sandbox. Use for data analysis (Pandas), math, file processing, or any computation that needs Python. Returns stdout + result.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python code to execute. Use print() to output results." },
        timeout: { type: "number", description: "Execution timeout in seconds (max 10, default 8)" },
      },
      required: ["code"],
    },
  },
  {
    name: "render_chart",
    description: "Generate a chart/graph using Python Matplotlib and return as a base64 PNG image.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python code using matplotlib to create the chart. Call plt.savefig('output.png') at the end." },
        title: { type: "string", description: "Optional chart title for context" },
      },
      required: ["code"],
    },
  },
];

export const computeToolHandlers: Record<string, ToolHandler> = {
  python_execute: async (args) => {
    const code = String(args["code"] ?? "");
    const timeout = Math.min(Number(args["timeout"] ?? 8), 10);
    logger.debug({ codePreview: code.slice(0, 80), timeout }, "python_execute called");
    const result = await callRunner("/execute", { code, timeout });
    return `\`\`\`\n${result}\n\`\`\` [^calc]`;
  },

  render_chart: async (args) => {
    const code = String(args["code"] ?? "");
    const title = String(args["title"] ?? "Chart");
    const result = await callRunner("/chart", { code, title });
    const parsed = JSON.parse(result) as { image_base64?: string; error?: string };
    if (parsed.error) return `❌ Chart render error: ${parsed.error}`;
    return `[IMAGE:base64:${parsed.image_base64}] [^calc]`;
  },
};
