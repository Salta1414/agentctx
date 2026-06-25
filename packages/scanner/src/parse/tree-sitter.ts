import { createRequire } from "node:module";
import type { SymbolKind } from "@niryn/agentctx-spec";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Parser = require("tree-sitter") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TypeScript = require("tree-sitter-typescript") as any;

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  signature: string;
  bodyText: string;
  exported: boolean;
  startLine: number;
  endLine: number;
}

export interface ParsedImport {
  specifier: string;
}

export interface ParsedCall {
  name: string;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  testFramework: string | null;
}

const parser = new Parser();
const tsLang = TypeScript.typescript;
const tsxLang = TypeScript.tsx;

function nodeText(source: string, node: { startIndex: number; endIndex: number }) {
  return source.slice(node.startIndex, node.endIndex);
}

function isExported(node: { parent: unknown; type: string }): boolean {
  let cur: { type: string; parent: unknown } | null = node as {
    type: string;
    parent: unknown;
  };
  while (cur) {
    if (cur.type === "export_statement" || cur.type === "export_declaration") {
      return true;
    }
    cur = cur.parent as { type: string; parent: unknown } | null;
  }
  return false;
}

function buildSignature(name: string, params: string, ret = ""): string {
  const r = ret ? `: ${ret}` : "";
  return `${name}(${params})${r}`;
}

function extractParams(source: string, node: { namedChild: (i: number) => unknown }) {
  const params = node.namedChild(0) as { startIndex: number; endIndex: number } | null;
  if (!params) return "";
  return nodeText(source, params).replace(/^\(|\)$/g, "");
}

function walk(node: {
  type: string;
  text?: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number };
  endPosition: { row: number };
  namedChild: (i: number) => unknown;
  namedChildCount: number;
  childForFieldName: (n: string) => unknown;
  parent: unknown;
  children?: unknown[];
}, source: string, out: ParseResult) {
  if (node.type === "import_statement" || node.type === "import_declaration") {
    const sourceNode = node.childForFieldName("source") as {
      startIndex: number;
      endIndex: number;
    } | null;
    if (sourceNode) {
      const spec = nodeText(source, sourceNode).replace(/['"]/g, "");
      out.imports.push({ specifier: spec });
      if (spec.includes("vitest") || spec === "vitest") out.testFramework = "vitest";
      if (spec.includes("jest") || spec === "@jest/globals") out.testFramework = "jest";
      if (spec.includes("mocha")) out.testFramework = "mocha";
    }
  }

  if (node.type === "function_declaration") {
    const nameNode = node.childForFieldName("name") as {
      startIndex: number;
      endIndex: number;
    } | null;
    if (nameNode) {
      const name = nodeText(source, nameNode);
      const params = extractParams(source, node as never);
      const body = nodeText(source, node);
      out.symbols.push({
        name,
        kind: "function",
        signature: buildSignature(name, params),
        bodyText: body,
        exported: isExported(node as never),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  if (node.type === "class_declaration") {
    const nameNode = node.childForFieldName("name") as {
      startIndex: number;
      endIndex: number;
    } | null;
    if (nameNode) {
      const name = nodeText(source, nameNode);
      out.symbols.push({
        name,
        kind: "class",
        signature: `class ${name}`,
        bodyText: nodeText(source, node),
        exported: isExported(node as never),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  if (node.type === "interface_declaration") {
    const nameNode = node.childForFieldName("name") as {
      startIndex: number;
      endIndex: number;
    } | null;
    if (nameNode) {
      const name = nodeText(source, nameNode);
      out.symbols.push({
        name,
        kind: "interface",
        signature: `interface ${name}`,
        bodyText: nodeText(source, node),
        exported: isExported(node as never),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  if (node.type === "type_alias_declaration") {
    const nameNode = node.childForFieldName("name") as {
      startIndex: number;
      endIndex: number;
    } | null;
    if (nameNode) {
      const name = nodeText(source, nameNode);
      out.symbols.push({
        name,
        kind: "type",
        signature: `type ${name}`,
        bodyText: nodeText(source, node),
        exported: isExported(node as never),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }

  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    const exported = isExported(node as never);
    for (let i = 0; i < node.namedChildCount; i++) {
      const decl = node.namedChild(i) as {
        type: string;
        childForFieldName: (n: string) => unknown;
        startIndex: number;
        endIndex: number;
        startPosition: { row: number };
        endPosition: { row: number };
      };
      if (decl?.type === "variable_declarator") {
        const nameNode = decl.childForFieldName("name") as {
          startIndex: number;
          endIndex: number;
        } | null;
        const valueNode = decl.childForFieldName("value") as {
          type: string;
        } | null;
        if (nameNode) {
          const name = nodeText(source, nameNode);
          const isFn =
            valueNode?.type === "arrow_function" ||
            valueNode?.type === "function_expression";
          out.symbols.push({
            name,
            kind: isFn ? "function" : "const",
            signature: isFn ? buildSignature(name, "") : `const ${name}`,
            bodyText: nodeText(source, decl),
            exported,
            startLine: decl.startPosition.row + 1,
            endLine: decl.endPosition.row + 1,
          });
        }
      }
    }
  }

  if (node.type === "call_expression") {
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

export function parseTypeScriptSource(relativePath: string, source: string): ParseResult {
  const isTsx = relativePath.endsWith(".tsx") || relativePath.endsWith(".jsx");
  parser.setLanguage(isTsx ? tsxLang : tsLang);
  const tree = parser.parse(source);
  const out: ParseResult = {
    symbols: [],
    imports: [],
    calls: [],
    testFramework: null,
  };
  walk(tree.rootNode as never, source, out);
  return out;
}