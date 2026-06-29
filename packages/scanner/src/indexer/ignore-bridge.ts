import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import { loadConfig } from "../features/detect.js";
import { DEFAULT_IGNORED_SEGMENTS } from "../ignore.js";
import { normalizeProjectRoot } from "../utils/paths.js";

/** Gitignore-style patterns for CBM discover (`.agentctx/.indexignore`). */
export function writeIndexIgnoreFile(projectRoot: string, extraIgnore: string[] = []): string {
  const root = normalizeProjectRoot(projectRoot);
  const config = loadConfig(root);
  const patterns = new Set<string>();

  for (const segment of DEFAULT_IGNORED_SEGMENTS) {
    patterns.add(`**/${segment}/**`);
  }
  for (const pattern of [...(config.ignore ?? []), ...extraIgnore]) {
    if (typeof pattern !== "string") continue;
    const trimmed = pattern.trim();
    if (trimmed) {
      patterns.add(trimmed);
    }
  }

  const agentDir = join(root, AGENTCTX_DIR);
  mkdirSync(agentDir, { recursive: true });
  const path = join(agentDir, ".indexignore");
  writeFileSync(path, `${[...patterns].sort().join("\n")}\n`, "utf8");
  return path;
}
