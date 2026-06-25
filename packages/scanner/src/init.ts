import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AGENTCTX_DIR, SPEC_VERSION } from "@niryn/agentctx-spec";

export interface InitResult {
  projectRoot: string;
  created: string[];
  skipped: string[];
}

function writeIfMissing(path: string, content: string): "created" | "skipped" {
  if (existsSync(path)) return "skipped";
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
  return "created";
}

export function initAgentCtx(projectRoot: string): InitResult {
  const root = resolve(projectRoot);
  const created: string[] = [];
  const skipped: string[] = [];

  const configPath = join(root, AGENTCTX_DIR, "config.json");
  const configStatus = writeIfMissing(
    configPath,
    `${JSON.stringify(
      {
        spec_version: SPEC_VERSION,
        ignores: ["node_modules", "dist", "build", ".next", "coverage"],
      },
      null,
      2,
    )}\n`,
  );
  (configStatus === "created" ? created : skipped).push(`${AGENTCTX_DIR}/config.json`);

  const agentsPath = join(root, "AGENTS.md");
  const agentsStatus = writeIfMissing(
    agentsPath,
    [
      "# Agent Instructions",
      "",
      "This project uses the AgentCtx standard (via Niryn).",
      "",
      "Before editing code:",
      "1. Run `niryn scan` (or add the folder in Niryn desktop) to build the graph.",
      "2. Read `.agentctx/current-context.md` after scanning.",
      "3. Use MCP `get_context_pack` or `POST /v1/context/pack` for task-specific context.",
      "",
    ].join("\n"),
  );
  (agentsStatus === "created" ? created : skipped).push("AGENTS.md");

  mkdirSync(join(root, AGENTCTX_DIR), { recursive: true });

  return { projectRoot: root, created, skipped };
}