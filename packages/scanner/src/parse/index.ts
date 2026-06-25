import { parsePhpSource } from "./php.js";
import { parsePythonSource } from "./python.js";
import { parseTypeScriptSource, type ParseResult } from "./tree-sitter.js";

export type { ParseResult, ParsedSymbol, ParsedImport, ParsedCall } from "./tree-sitter.js";

export function parseSource(relativePath: string, source: string): ParseResult {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".py")) return parsePythonSource(source);
  if (lower.endsWith(".php")) return parsePhpSource(source);
  return parseTypeScriptSource(relativePath, source);
}