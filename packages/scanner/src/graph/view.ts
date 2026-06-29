export interface GraphFile {
  id: string;
  path: string;
  language: string;
  featureId: string | null;
  isTest: boolean;
  isEntrypoint: boolean;
  contentHash: string;
}

export interface GraphSymbol {
  id: string;
  fileId: string;
  name: string;
  kind: string;
  signature: string;
  qualifiedName: string;
  bodyHash: string;
  exported: boolean;
  startLine: number | null;
  endLine: number | null;
}

export interface GraphRelation {
  id: string;
  sourceKind: "symbol" | "file" | "feature";
  sourceId: string;
  targetKind: "symbol" | "file" | "feature";
  targetId: string;
  relation: string;
  weight: number;
}

export interface GraphFeature {
  id: string;
  slug: string;
  name: string;
  entrypointPath: string | null;
}

export interface TraceNode {
  qualifiedName: string;
  path: string;
  hop: number;
  direction: "caller" | "callee";
  edgeType: string;
}

export interface SemanticHit {
  symbolId: string;
  name: string;
  path: string;
  score: number;
  reason: string;
}

export interface ChangeImpact {
  path: string;
  symbols: Array<{ name: string; qualifiedName: string; risk: "low" | "medium" | "high" }>;
  blastRadius: number;
}

export interface GraphViewOptions {
  projectRoot: string;
  dbPath?: string;
  readonly?: boolean;
}

export interface GraphView {
  readonly projectRoot: string;
  readonly projectId: string;

  getFeatures(): GraphFeature[];
  getFiles(): GraphFile[];
  getSymbols(): GraphSymbol[];
  getRelations(): GraphRelation[];

  tracePath(opts: {
    nameOrQualified: string;
    direction: "callers" | "callees" | "both";
    depth?: number;
  }): TraceNode[];

  semanticQuery(task: string, limit?: number): SemanticHit[];
  detectChanges(): ChangeImpact[];
  queryCypher(cypher: string): unknown;
  getArchitecture(): Record<string, unknown>;
  close(): void;
}

export type { GraphView as default };
