import type Database from "better-sqlite3";
import type { IndexHandle } from "@niryn/indexer-node";
import {
  cbmEdgeToRelation,
  mapCbmNodeToGraphSymbol,
  SYMBOL_LABELS,
  type CbmGraphNode,
} from "./map-cbm.js";

const EDGE_TYPES = ["CALLS", "IMPORTS", "HTTP_CALLS", "ASYNC_CALLS", "SEMANTICALLY_RELATED"];

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

function loadSymbolNodesFromDb(
  db: Database.Database,
  projectId: string,
): CbmGraphNode[] | null {
  if (!tableExists(db, "cbm_nodes")) {
    return null;
  }
  const project = db
    .prepare(`SELECT cbm_project_key FROM projects WHERE id = ?`)
    .get(projectId) as { cbm_project_key: string | null } | undefined;
  const cbmKey = project?.cbm_project_key;
  if (!cbmKey) {
    return null;
  }
  const placeholders = SYMBOL_LABELS.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT id, label, name, qualified_name, file_path, start_line, end_line
       FROM cbm_nodes
       WHERE project = ? AND label IN (${placeholders})`,
    )
    .all(cbmKey, ...SYMBOL_LABELS) as CbmGraphNode[];
}

function loadSymbolNodesFromHandle(handle: IndexHandle): CbmGraphNode[] {
  const nodes: CbmGraphNode[] = [];
  for (const label of SYMBOL_LABELS) {
    nodes.push(...handle.searchGraph({ label, limit: 50_000 }));
  }
  return nodes;
}

export function rebuildSymbolCache(
  db: Database.Database,
  projectId: string,
  handle: IndexHandle,
): number {
  db.prepare(`DELETE FROM niryn_symbol_cache WHERE project_id = ?`).run(projectId);

  const fileIdByPath = new Map<string, string>();
  const files = db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>;
  for (const f of files) {
    fileIdByPath.set(f.path, f.id);
  }

  const insert = db.prepare(
    `INSERT INTO niryn_symbol_cache
      (project_id, id, file_path, name, kind, qualified_name, signature, exported, start_line, end_line)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const nodes = loadSymbolNodesFromDb(db, projectId) ?? loadSymbolNodesFromHandle(handle);

  let count = 0;
  const tx = db.transaction(() => {
    for (const node of nodes) {
      const sym = mapCbmNodeToGraphSymbol(node, (path) => fileIdByPath.get(path) ?? path);
      insert.run(
        projectId,
        sym.id,
        node.file_path,
        sym.name,
        sym.kind,
        sym.qualifiedName,
        sym.signature,
        sym.exported ? 1 : 0,
        sym.startLine,
        sym.endLine,
      );
      count += 1;
    }
  });
  tx();
  return count;
}

export function rebuildRelationCache(
  db: Database.Database,
  projectId: string,
  _handle?: IndexHandle,
): number {
  db.prepare(`DELETE FROM niryn_relation_cache WHERE project_id = ?`).run(projectId);

  const symbols = db
    .prepare(`SELECT * FROM niryn_symbol_cache WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string }>;
  const symbolIds = new Set(symbols.map((s) => s.id));
  if (symbolIds.size === 0) {
    return 0;
  }

  const project = db
    .prepare(`SELECT cbm_project_key FROM projects WHERE id = ?`)
    .get(projectId) as { cbm_project_key: string | null } | undefined;
  const cbmKey = project?.cbm_project_key;
  if (!cbmKey) {
    return 0;
  }

  const edgePlaceholders = EDGE_TYPES.map(() => "?").join(", ");
  const edgeRows = db
    .prepare(
      `SELECT source_id, target_id, type FROM cbm_edges
       WHERE project = ? AND type IN (${edgePlaceholders})`,
    )
    .all(cbmKey, ...EDGE_TYPES) as Array<{
    source_id: number;
    target_id: number;
    type: string;
  }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO niryn_relation_cache
      (project_id, id, source_id, target_id, relation, weight)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let count = 0;
  const tx = db.transaction(() => {
    for (const edge of edgeRows) {
      const sourceId = String(edge.source_id);
      const targetId = String(edge.target_id);
      if (!symbolIds.has(sourceId) || !symbolIds.has(targetId)) {
        continue;
      }
      const relation = cbmEdgeToRelation(edge.type);
      insert.run(
        projectId,
        `${sourceId}:${relation}:${targetId}`,
        sourceId,
        targetId,
        relation,
        1,
      );
      count += 1;
    }
  });
  tx();
  return count;
}
