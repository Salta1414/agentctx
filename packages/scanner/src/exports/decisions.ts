import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENTCTX_DIR,
  DECISIONS_FILE,
  type DecisionsSnapshot,
  type ProjectDecision,
} from "@niryn/agentctx-spec";

function readActiveDecisions(projectRoot: string): ProjectDecision[] {
  try {
    const raw = JSON.parse(
      readFileSync(join(projectRoot, AGENTCTX_DIR, DECISIONS_FILE), "utf8"),
    ) as DecisionsSnapshot;
    if (!Array.isArray(raw.decisions)) return [];
    return raw.decisions.filter((d) => d.status === "active");
  } catch {
    return [];
  }
}

export function buildDecisionsSection(projectRoot: string): string {
  const decisions = readActiveDecisions(projectRoot);
  if (decisions.length === 0) return "";

  const lines = [
    "## Active decisions",
    "",
    "_Captured via MCP `record_decision` or the decisions API — not overwritten on scan._",
    "",
  ];

  for (const d of decisions.slice(0, 20)) {
    const tags = d.tags.length > 0 ? ` _(${d.tags.join(", ")})_` : "";
    lines.push(`- **${d.summary}**${tags}`);
    if (d.rationale) lines.push(`  - ${d.rationale}`);
    if (d.supersedes.length > 0) {
      lines.push(`  - Supersedes: ${d.supersedes.join(", ")}`);
    }
  }

  if (decisions.length > 20) {
    lines.push(`- _…${decisions.length - 20} more active decisions_`);
  }

  lines.push("");
  return lines.join("\n");
}