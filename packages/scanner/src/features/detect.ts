import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { slugToName, toPosixPath } from "../utils/paths.js";

export interface DetectedFeature {
  slug: string;
  name: string;
  detection: "path-heuristic" | "manual" | "config";
  paths: string[];
  entrypoint?: string;
  depends_on?: string[];
}

const PATH_PATTERNS = [
  /^src\/features\/([^/]+)\//,
  /^src\/modules\/([^/]+)\//,
  /^app\/([^/]+)\//,
  /^packages\/([^/]+)\//,
];

export interface AgentCtxConfig {
  features?: {
    manual?: Array<{
      slug: string;
      name?: string;
      entrypoints?: string[];
    }>;
  };
  ignore?: string[];
}

export function loadConfig(projectRoot: string): AgentCtxConfig {
  const configPath = join(projectRoot, ".agentctx", "config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as AgentCtxConfig;
  } catch {
    return {};
  }
}

export function detectFeatures(
  filePaths: string[],
  config: AgentCtxConfig,
): DetectedFeature[] {
  const bySlug = new Map<string, DetectedFeature>();

  for (const manual of config.features?.manual ?? []) {
    bySlug.set(manual.slug, {
      slug: manual.slug,
      name: manual.name ?? slugToName(manual.slug),
      detection: "config",
      paths: [],
      entrypoint: manual.entrypoints?.[0],
    });
  }

  for (const filePath of filePaths) {
    const p = toPosixPath(filePath);
    for (const pattern of PATH_PATTERNS) {
      const match = p.match(pattern);
      if (!match?.[1]) continue;
      const slug = match[1];
      if (!bySlug.has(slug)) {
        bySlug.set(slug, {
          slug,
          name: slugToName(slug),
          detection: "path-heuristic",
          paths: [],
        });
      }
      bySlug.get(slug)!.paths.push(p);
      if (p.endsWith("/index.ts") || p.endsWith("/index.tsx")) {
        bySlug.get(slug)!.entrypoint ??= p;
      }
    }
  }

  for (const feature of bySlug.values()) {
    if (!feature.entrypoint && feature.paths.length > 0) {
      feature.entrypoint = feature.paths.find((p) => !p.includes(".test.")) ?? feature.paths[0];
    }
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function featureForPath(
  filePath: string,
  _features: DetectedFeature[],
): string | null {
  const p = toPosixPath(filePath);
  for (const pattern of PATH_PATTERNS) {
    const match = p.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}