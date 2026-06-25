import { toPosixPath } from "./utils/paths.js";

export const DEFAULT_IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "vendor",
  ".agentctx",
  ".turbo",
]);

const GENERATED_PATTERNS = [
  /^convex\/_generated\//,
  /\/convex\/_generated\//,
  /\.(generated|gen)\.[^/]+$/,
];

function globToRegExp(glob: string): RegExp {
  const placeholder = "\u0000";
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, placeholder)
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped.replaceAll(placeholder, ".*")}$`);
}

function matchesExtraIgnore(path: string, pattern: string): boolean {
  const normalized = toPosixPath(pattern.trim()).replace(/^\.\/+/, "");
  if (!normalized) return false;
  if (normalized.includes("*")) return globToRegExp(normalized).test(path);
  return (
    path === normalized ||
    path.startsWith(`${normalized}/`) ||
    path.includes(`/${normalized}/`) ||
    path.endsWith(`/${normalized}`)
  );
}

export function isRepoIgnoredPath(
  path: string,
  extraIgnore: string[] = [],
): boolean {
  const normalized = toPosixPath(path).replace(/^\.\/+/, "");
  if (!normalized) return false;
  const segments = normalized.split("/");
  if (segments.some((segment) => DEFAULT_IGNORED_SEGMENTS.has(segment))) {
    return true;
  }
  if (GENERATED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return extraIgnore.some((pattern) => matchesExtraIgnore(normalized, pattern));
}

export function isAllowedSourcePath(
  path: string,
  extraIgnore: string[] = [],
): boolean {
  return !isRepoIgnoredPath(path, extraIgnore);
}
