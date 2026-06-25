import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".php"];

export function toPosixPath(path: string): string {
  return path.split("\\").join("/");
}

export function resolveImportPath(
  fromFile: string,
  specifier: string,
  projectRoot: string,
): string | null {
  if (!specifier.startsWith(".")) return null;

  const normalized = specifier.replace(/\.(js|mjs|cjs|jsx)$/, "");
  const base = resolve(dirname(fromFile), normalized);
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return toPosixPath(relative(projectRoot, candidate));
    }
  }
  return null;
}

export function languageFromPath(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  if (ext === "tsx") return "tsx";
  if (ext === "ts") return "ts";
  if (ext === "jsx") return "jsx";
  if (ext === "py") return "python";
  if (ext === "php") return "php";
  return "js";
}

export function isTestPath(path: string): boolean {
  const p = toPosixPath(path);
  if (p.includes("/__tests__/") || p.startsWith("tests/")) return true;
  return /\.(test|spec)\.(ts|tsx|js|jsx|py|php)$/.test(p) || p.includes("test_") && p.endsWith(".py");
}

export function slugToName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function normalizeProjectRoot(root: string): string {
  return resolve(normalize(root));
}