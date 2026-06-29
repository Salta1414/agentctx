import Database from "better-sqlite3";
import { join, resolve } from "node:path";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import {
  openIndexHandle,
  type IndexHandle,
  type SearchGraphOptions,
} from "@niryn/indexer-node";
import type {
  ChangeImpact,
  GraphFeature,
  GraphFile,
  GraphRelation,
  GraphSymbol,
  GraphView,
  GraphViewOptions,
  SemanticHit,
  TraceNode,
} from "./view.js";
import { SYMBOL_LABELS } from "./map-cbm.js";

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

export class CbmGraphView implements GraphView {
  readonly projectRoot: string;
  readonly projectId: string;

  private db: Database.Database;
  private handle: IndexHandle;

  constructor(opts: GraphViewOptions) {
    this.projectRoot = resolve(opts.projectRoot);
    const dbPath = opts.dbPath ?? join(this.projectRoot, AGENTCTX_DIR, "context.db");
    this.db = new Database(dbPath, { readonly: opts.readonly ?? true });

    const project = this.db
      .prepare(`SELECT id FROM projects WHERE root_path = ?`)
      .get(this.projectRoot) as { id: string } | undefined;
    if (!project) {
      throw new Error(`No Niryn project row for ${this.projectRoot}`);
    }
    this.projectId = project.id;
    this.handle = openIndexHandle(dbPath, this.projectRoot, this.projectId);
  }

  getFeatures(): GraphFeature[] {
    const rows = this.db
      .prepare(
        `SELECT f.id, f.slug, f.name, fi.path as entrypoint_path
         FROM features f
         LEFT JOIN files fi ON fi.id = f.entrypoint_file_id
         WHERE f.project_id = ?`,
      )
      .all(this.projectId) as Array<{
      id: string;
      slug: string;
      name: string;
      entrypoint_path: string | null;
    }>;
    return rows.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      entrypointPath: f.entrypoint_path,
    }));
  }

  getFiles(): GraphFile[] {
    const rows = this.db
      .prepare(
        `SELECT id, path, feature_id, is_test, is_entrypoint, content_hash
         FROM files WHERE project_id = ?`,
      )
      .all(this.projectId) as Array<{
      id: string;
      path: string;
      feature_id: string | null;
      is_test: number;
      is_entrypoint: number;
      content_hash: string;
    }>;
    return rows.map((f) => ({
      id: f.id,
      path: f.path,
      language: "unknown",
      featureId: f.feature_id,
      isTest: f.is_test === 1,
      isEntrypoint: f.is_entrypoint === 1,
      contentHash: f.content_hash,
    }));
  }

  getSymbols(): GraphSymbol[] {
    const fileIdByPath = new Map(this.getFiles().map((f) => [f.path, f.id]));

    if (tableExists(this.db, "niryn_symbol_cache")) {
      const cached = this.db
        .prepare(
          `SELECT id, file_path, name, kind, qualified_name, signature, exported, start_line, end_line
           FROM niryn_symbol_cache WHERE project_id = ?`,
        )
        .all(this.projectId) as Array<{
        id: string;
        file_path: string;
        name: string;
        kind: string;
        qualified_name: string;
        signature: string | null;
        exported: number;
        start_line: number | null;
        end_line: number | null;
      }>;

      if (cached.length > 0) {
        return cached.map((s) => ({
          id: s.id,
          fileId: fileIdByPath.get(s.file_path) ?? s.file_path,
          name: s.name,
          kind: s.kind,
          signature: s.signature ?? s.qualified_name,
          qualifiedName: s.qualified_name,
          bodyHash: "",
          exported: s.exported === 1,
          startLine: s.start_line,
          endLine: s.end_line,
        }));
      }
    }

    if (tableExists(this.db, "symbols")) {
      const legacy = this.db
        .prepare(
          `SELECT s.id, s.file_id, s.name, s.kind, s.signature, s.body_hash, s.exported, s.start_line, s.end_line, f.path
           FROM symbols s JOIN files f ON f.id = s.file_id
           WHERE f.project_id = ?`,
        )
        .all(this.projectId) as Array<{
        id: string;
        file_id: string;
        name: string;
        kind: string;
        signature: string;
        body_hash: string;
        exported: number;
        start_line: number | null;
        end_line: number | null;
        path: string;
      }>;
      if (legacy.length > 0) {
        return legacy.map((s) => ({
          id: s.id,
          fileId: s.file_id,
          name: s.name,
          kind: s.kind,
          signature: s.signature,
          qualifiedName: s.signature,
          bodyHash: s.body_hash,
          exported: s.exported === 1,
          startLine: s.start_line,
          endLine: s.end_line,
        }));
      }
    }

    const nodes = this.handle.searchGraph({ labels: SYMBOL_LABELS, limit: 5000 } as SearchGraphOptions);
    return nodes.map((n) => ({
      id: String(n.id),
      fileId: fileIdByPath.get(n.file_path) ?? n.file_path,
      name: n.name,
      kind: n.label.toLowerCase(),
      signature: n.qualified_name,
      qualifiedName: n.qualified_name,
      bodyHash: "",
      exported: true,
      startLine: n.start_line > 0 ? n.start_line : null,
      endLine: n.end_line > 0 ? n.end_line : null,
    }));
  }

  getRelations(): GraphRelation[] {
    const merged = new Map<string, GraphRelation>();

    if (tableExists(this.db, "niryn_relation_cache")) {
      const cacheRows = this.db
        .prepare(
          `SELECT id, source_id, target_id, relation, weight
           FROM niryn_relation_cache WHERE project_id = ?`,
        )
        .all(this.projectId) as Array<{
        id: string;
        source_id: string;
        target_id: string;
        relation: string;
        weight: number;
      }>;

      for (const r of cacheRows) {
        merged.set(r.id, {
          id: r.id,
          sourceKind: "symbol",
          sourceId: r.source_id,
          targetKind: "symbol",
          targetId: r.target_id,
          relation: r.relation,
          weight: r.weight,
        });
      }
    }

    if (tableExists(this.db, "relations")) {
      const overlayRows = this.db
        .prepare(
          `SELECT id, source_kind, source_id, target_kind, target_id, relation, weight
           FROM relations`,
        )
        .all() as Array<{
        id: string;
        source_kind: string;
        source_id: string;
        target_kind: string;
        target_id: string;
        relation: string;
        weight: number;
      }>;

      for (const r of overlayRows) {
        merged.set(r.id, {
          id: r.id,
          sourceKind: r.source_kind as GraphRelation["sourceKind"],
          sourceId: r.source_id,
          targetKind: r.target_kind as GraphRelation["targetKind"],
          targetId: r.target_id,
          relation: r.relation,
          weight: r.weight,
        });
      }
    }

    return [...merged.values()];
  }

  tracePath(opts: {
    nameOrQualified: string;
    direction: "callers" | "callees" | "both";
    depth?: number;
  }): TraceNode[] {
    const nodes = this.handle.tracePath({
      nameOrQualified: opts.nameOrQualified,
      direction: opts.direction,
      depth: opts.depth,
    });
    return nodes.map((n) => ({
      qualifiedName: n.qualified_name,
      path: n.path,
      hop: n.hop,
      direction: n.direction === "callee" ? "callee" : "caller",
      edgeType: n.edge_type,
    }));
  }

  semanticQuery(task: string, limit = 20): SemanticHit[] {
    const hits = this.handle.semanticQuery(task, limit);
    return hits.map((h) => ({
      symbolId: String(h.symbol_id),
      name: h.name,
      path: h.path,
      score: h.score,
      reason: h.reason,
    }));
  }

  detectChanges(): ChangeImpact[] {
    const data = this.handle.detectChanges() as { impacts?: ChangeImpact[] };
    return data?.impacts ?? [];
  }

  queryCypher(cypher: string): unknown {
    return this.handle.queryCypher(cypher);
  }

  getArchitecture(): Record<string, unknown> {
    return this.handle.getArchitecture();
  }

  close(): void {
    this.handle.close();
    this.db.close();
  }
}

export function openGraphView(opts: GraphViewOptions): GraphView {
  return new CbmGraphView(opts);
}
