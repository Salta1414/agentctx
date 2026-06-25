import type { SymbolKind } from "@niryn/agentctx-spec";
import type { ParseResult } from "./tree-sitter.js";

const CLASS_RE = /\b(?:abstract\s+)?class\s+(\w+)/g;
const FUNC_RE = /\bfunction\s+(\w+)\s*\(/g;
const NAMESPACE_RE = /^namespace\s+([^;]+);/m;
const USE_RE = /^use\s+([^;]+);/gm;

export function parsePhpSource(source: string): ParseResult {
  const symbols: ParseResult["symbols"] = [];
  const imports: ParseResult["imports"] = [];
  const calls: ParseResult["calls"] = [];

  const ns = source.match(NAMESPACE_RE);
  const namespace = ns?.[1];
  if (namespace) imports.push({ specifier: namespace.trim() });

  for (const m of source.matchAll(USE_RE)) {
    const specifier = m[1];
    if (specifier) imports.push({ specifier: specifier.trim() });
  }

  for (const m of source.matchAll(CLASS_RE)) {
    const name = m[1];
    if (!name) continue;
    const idx = m.index ?? 0;
    const line = source.slice(0, idx).split("\n").length;
    symbols.push({
      name,
      kind: "class" as SymbolKind,
      signature: `class ${name}`,
      bodyText: m[0],
      exported: true,
      startLine: line,
      endLine: line,
    });
  }

  for (const m of source.matchAll(FUNC_RE)) {
    const name = m[1];
    if (!name) continue;
    if (name === "__construct") continue;
    const idx = m.index ?? 0;
    const line = source.slice(0, idx).split("\n").length;
    symbols.push({
      name,
      kind: "function" as SymbolKind,
      signature: `function ${name}(...)`,
      bodyText: m[0],
      exported: !name.startsWith("_"),
      startLine: line,
      endLine: line,
    });
  }

  for (const m of source.matchAll(/\b(\w+)\s*\(/g)) {
    const name = m[1];
    if (!name) continue;
    if (["if", "for", "while", "switch", "function", "class", "return", "new"].includes(name)) {
      continue;
    }
    calls.push({ name });
  }

  return {
    symbols,
    imports,
    calls: calls.slice(0, 200),
    testFramework: source.includes("PHPUnit") ? "phpunit" : null,
  };
}
