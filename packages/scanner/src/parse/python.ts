import { createRequire } from "node:module";
import type { SymbolKind } from "@niryn/agentctx-spec";
import type { ParseResult, ParsedSymbol } from "./tree-sitter.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Parser = require("tree-sitter") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Python = require("tree-sitter-python") as any;

const parser = new Parser();
parser.setLanguage(Python);

function nodeText(source: string, node: { startIndex: number; endIndex: number }) {
  return source.slice(node.startIndex, node.endIndex);
}

function walk(
  node: {
    type: string;
    startIndex: number;
    endIndex: number;
    startPosition: { row: number };
    endPosition: { row: number };
    namedChild: (i: number) => unknown;
    namedChildCount: number;
    childForFieldName: (n: string) => unknown;
  },
  source: string,
  out: ParseResult,
) {
  if (node.type === "function_definition") {
    const nameNode = node.childForFieldName("name") as {
      startIndex: number;
      endIndex: number;
    } | null;
    if (nameNode) {
      const name = nodeText(source, nameNode);
      out.symbols.push({
        name,
        kind: "function" as SymbolKind,
        signature: `def ${name}(...)`,
        bodyText: nodeText(source, node),
        exported: !name.startsWith("_"),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  if (node.type === "class_definition") {
    const nameNode = node.childForFieldName("name") as {
      startIndex: number;
      endIndex: number;
    } | null;
    if (nameNode) {
      const name = nodeText(source, nameNode);
      out.symbols.push({
        name,
        kind: "class" as SymbolKind,
        signature: `class ${name}`,
        bodyText: nodeText(source, node),
        exported: !name.startsWith("_"),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  if (node.type === "import_statement" || node.type === "import_from_statement") {
    out.imports.push({ specifier: nodeText(source, node).trim() });
  }

  if (node.type === "call") {
    const fn = node.childForFieldName("function") as {
      type: string;
      startIndex: number;
      endIndex: number;
    } | null;
    if (fn?.type === "identifier") {
      out.calls.push({ name: nodeText(source, fn) });
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    walk(node.namedChild(i) as never, source, out);
  }
}

export function parsePythonSource(source: string): ParseResult {
  const tree = parser.parse(source);
  const out: ParseResult = {
    symbols: [],
    imports: [],
    calls: [],
    testFramework: source.includes("pytest") ? "pytest" : source.includes("unittest") ? "unittest" : null,
  };
  walk(tree.rootNode as never, source, out);
  return out;
}