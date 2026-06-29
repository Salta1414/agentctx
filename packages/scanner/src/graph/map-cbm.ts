import type { GraphRelation, GraphSymbol } from "./view.js";

export interface CbmGraphNode {
  id: number;
  label: string;
  name: string;
  qualified_name: string;
  file_path: string;
  start_line: number;
  end_line: number;
}

const LABEL_KIND: Record<string, string> = {
  Function: "function",
  Method: "method",
  Class: "class",
  Interface: "interface",
  Struct: "struct",
  Enum: "enum",
  Type: "type",
  Module: "module",
  Variable: "variable",
  Constant: "constant",
  Property: "property",
  Field: "field",
};

const EDGE_RELATION: Record<string, string> = {
  CALLS: "calls",
  IMPORTS: "imports",
  HTTP_CALLS: "http_calls",
  ASYNC_CALLS: "async_calls",
  SEMANTICALLY_RELATED: "semantic",
  INHERITS: "inherits",
  IMPLEMENTS: "implements",
  DECORATES: "decorates",
};

export function cbmLabelToKind(label: string): string {
  return LABEL_KIND[label] ?? label.toLowerCase();
}

export function cbmEdgeToRelation(edgeType: string): string {
  return EDGE_RELATION[edgeType] ?? edgeType.toLowerCase();
}

export function mapCbmNodeToGraphSymbol(
  node: CbmGraphNode,
  fileIdForPath: (path: string) => string,
): GraphSymbol {
  const fileId = fileIdForPath(node.file_path);
  return {
    id: String(node.id),
    fileId,
    name: node.name,
    kind: cbmLabelToKind(node.label),
    signature: node.qualified_name,
    qualifiedName: node.qualified_name,
    bodyHash: "",
    exported: true,
    startLine: node.start_line > 0 ? node.start_line : null,
    endLine: node.end_line > 0 ? node.end_line : null,
  };
}

export function mapCbmEdgeToGraphRelation(
  edge: { id: string; source_id: string; target_id: string; relation: string; weight?: number },
): GraphRelation {
  return {
    id: edge.id,
    sourceKind: "symbol",
    sourceId: edge.source_id,
    targetKind: "symbol",
    targetId: edge.target_id,
    relation: edge.relation,
    weight: edge.weight ?? 1,
  };
}

export const SYMBOL_LABELS = ["Function", "Method", "Class", "Interface", "Struct", "Enum", "Type"];
