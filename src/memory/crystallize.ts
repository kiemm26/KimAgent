// src/memory/crystallize.ts
// Voyager Procedural Memory — crystallizes successful multi-step interactions
// into reusable skill Markdown files stored in /skills/
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { dbRun, dbQuery } from "../db/sqlite.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { ReActResult, SkillRow } from "../types.js";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "..", "skills", "templates");

export async function crystallizeInBackground(
  jid: string,
  userQuery: string,
  result: ReActResult
): Promise<void> {
  const config = getConfig();
  if (!config.crystallization.enabled) return;
  if (result.steps.length < config.crystallization.minSteps) return;

  // Check if any tool calls were made and all were successful
  const hasTools = result.steps.some((s) => s.action);
  const hasErrors = result.steps.some((s) => s.observation?.isError);
  if (!hasTools || hasErrors) return;

  logger.info({ jid, steps: result.steps.length }, "Crystallization: analyzing successful interaction");

  try {
    // Check if similar skill already exists
    const toolsUsed = result.steps
      .filter((s) => s.action)
      .map((s) => s.action!.name);

    const existingSkill = dbQuery<SkillRow>(
      `SELECT id FROM skills WHERE tools_used LIKE ? LIMIT 1`,
      [`%${toolsUsed[0]}%`]
    );

    if (existingSkill.length > 0) {
      // Update usage count instead
      dbRun(`UPDATE skills SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`, [
        Math.floor(Date.now() / 1000),
        existingSkill[0]?.id ?? "",
      ]);
      logger.debug({ skillId: existingSkill[0]?.id }, "Crystallization: updated existing skill usage count");
      return;
    }

    // Build skill content
    const skillId = randomUUID();
    const title = generateTitle(userQuery, toolsUsed);
    const description = `Automatically crystallized from a ${result.steps.length}-step interaction using: ${toolsUsed.join(", ")}`;
    const content = buildSkillMarkdown(userQuery, result, toolsUsed);
    const triggerPatterns = JSON.stringify([userQuery.slice(0, 100)]);
    const toolsJson = JSON.stringify([...new Set(toolsUsed)]);
    const now = Math.floor(Date.now() / 1000);

    // Save to DB
    dbRun(
      `INSERT INTO skills (id, title, description, trigger_patterns, tools_used, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [skillId, title, description, triggerPatterns, toolsJson, content, now, now]
    );

    // Save to filesystem
    mkdirSync(SKILLS_DIR, { recursive: true });
    const filename = `${skillId}.md`;
    writeFileSync(join(SKILLS_DIR, filename), content, "utf8");

    // Update skills index
    updateSkillsIndex(skillId, title, description, toolsUsed);

    logger.info({ skillId, title }, "Crystallization: new skill saved");
  } catch (err) {
    logger.error({ err }, "Crystallization failed");
  }
}

function generateTitle(query: string, tools: string[]): string {
  const toolSummary = [...new Set(tools)].slice(0, 2).join(" + ");
  const querySnippet = query.slice(0, 40).replace(/[^a-zA-Z0-9\s]/g, "").trim();
  return `${querySnippet} [${toolSummary}]`;
}

function buildSkillMarkdown(query: string, result: ReActResult, tools: string[]): string {
  const steps = result.steps
    .map((s, i) => {
      let step = `### Step ${i + 1}\n**Thought:** ${s.thought}\n`;
      if (s.action) {
        step += `**Action:** \`${s.action.name}(${JSON.stringify(s.action.arguments)})\`\n`;
      }
      if (s.observation) {
        step += `**Observation:** ${s.observation.content.slice(0, 200)}\n`;
      }
      return step;
    })
    .join("\n");

  return `# Skill: ${query.slice(0, 60)}\n\n` +
    `**Tools Used:** ${tools.join(", ")}\n` +
    `**Steps:** ${result.steps.length}\n` +
    `**Model:** ${result.model}\n\n` +
    `## Trigger Pattern\n${query}\n\n` +
    `## Procedure\n${steps}\n\n` +
    `## Final Answer\n${result.answer.slice(0, 500)}\n`;
}

function updateSkillsIndex(id: string, title: string, description: string, tools: string[]): void {
  const indexPath = join(__dirname, "..", "..", "skills", "index.json");
  let index: Array<{ id: string; title: string; description: string; tools: string[] }> = [];

  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    // Start fresh if index doesn't exist
  }

  index.push({ id, title, description, tools });
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
}
