import type Database from "better-sqlite3";
import type { IndexHandle } from "@niryn/indexer-node";
import {
  detectFeatures,
  featureForPath,
  loadConfig,
  type DetectedFeature,
} from "../features/detect.js";
import { cbmEdgeToRelation } from "../graph/map-cbm.js";
import { rebuildRelationCache, rebuildSymbolCache } from "../graph/cache.js";
import { isRepoIgnoredPath } from "../ignore.js";
import { walkSourceFiles } from "../walk/files.js";

const CBM_CALL_EDGE_TYPES = ["CALLS", "HTTP_CALLS", "ASYNC_CALLS"];
const CBM_IMPORT_EDGE_TYPES = ["IMPORTS"];

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

function deleteProjectRelations(db: Database.Database, projectId: string): void {
  const fileIds = db
    .prepare(`SELECT id FROM files WHERE project_id = ?`)
    .all(projectId)
    .map((r) => (r as { id: string }).id);
  const featureIds = db
    .prepare(`SELECT id FROM features WHERE project_id = ?`)
    .all(projectId)
    .map((r) => (r as { id: string }).id);
  const symbolIds = db
    .prepare(`SELECT id FROM niryn_symbol_cache WHERE project_id = ?`)
    .all(projectId)
    .map((r) => (r as { id: string }).id);
  const ids = [...fileIds, ...featureIds, ...symbolIds];
  if (ids.length === 0) {
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM relations WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
  ).run(...ids, ...ids);
}

export function assignFileFeatures(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
  features: DetectedFeature[],
): void {
  const config = loadConfig(projectRoot);
  const featureIdBySlug = new Map<string, string>();

  db.prepare(`DELETE FROM features WHERE project_id = ?`).run(projectId);
  const insertFeature = db.prepare(
    `INSERT INTO features (id, project_id, slug, name, detection, entrypoint_file_id)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );
  for (const feature of features) {
    const id = crypto.randomUUID();
    featureIdBySlug.set(feature.slug, id);
    insertFeature.run(id, projectId, feature.slug, feature.name, feature.detection);
  }

  const files = db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>;

  const updateFile = db.prepare(`UPDATE files SET feature_id = ? WHERE id = ?`);
  const entryStmt = db.prepare(`UPDATE features SET entrypoint_file_id = ? WHERE id = ?`);

  for (const file of files) {
    if (isRepoIgnoredPath(file.path, config.ignore ?? [])) {
      continue;
    }
    const slug = featureForPath(file.path, features);
    if (!slug) {
      updateFile.run(null, file.id);
      continue;
    }
    const featureId = featureIdBySlug.get(slug);
    if (!featureId) {
      continue;
    }
    updateFile.run(featureId, file.id);
    if (features.find((f) => f.slug === slug)?.entrypoint === file.path) {
      db.prepare(`UPDATE files SET is_entrypoint = 1 WHERE id = ?`).run(file.id);
      entryStmt.run(file.id, featureId);
    }
  }
}

export function rebuildNirynRelations(
  db: Database.Database,
  projectId: string,
  cbmProjectKey: string,
): number {
  if (!tableExists(db, "cbm_edges") || !tableExists(db, "cbm_nodes")) {
    return 0;
  }

  deleteProjectRelations(db, projectId);

  const fileIdByPath = new Map<string, string>();
  for (const row of db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>) {
    fileIdByPath.set(row.path, row.id);
  }

  const symbolById = new Map<
    string,
    { id: string; file_path: string; name: string }
  >();
  for (const row of db
    .prepare(
      `SELECT id, file_path, name FROM niryn_symbol_cache WHERE project_id = ?`,
    )
    .all(projectId) as Array<{ id: string; file_path: string; name: string }>) {
    symbolById.set(row.id, row);
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO relations (id, source_kind, source_id, target_kind, target_id, relation, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let count = 0;
  const edgeTypes = [...CBM_CALL_EDGE_TYPES, ...CBM_IMPORT_EDGE_TYPES];

  const tx = db.transaction(() => {
    for (const edgeType of edgeTypes) {
      const rows = db
        .prepare(
          `SELECT e.source_id, e.target_id, e.type
           FROM cbm_edges e
           JOIN cbm_nodes sn ON sn.id = e.source_id AND sn.project = e.project
           JOIN cbm_nodes tn ON tn.id = e.target_id AND tn.project = e.project
           WHERE e.project = ? AND e.type = ?`,
        )
        .all(cbmProjectKey, edgeType) as Array<{
        source_id: number;
        target_id: number;
        type: string;
      }>;

      for (const edge of rows) {
        const sourceId = String(edge.source_id);
        const targetId = String(edge.target_id);
        const relation = cbmEdgeToRelation(edge.type);

        if (CBM_CALL_EDGE_TYPES.includes(edgeType)) {
          const targetSym = symbolById.get(targetId);
          const sourceSym = symbolById.get(sourceId);
          if (!targetSym || !sourceSym) {
            continue;
          }
          const sourceFileId = fileIdByPath.get(sourceSym.file_path);
          if (!sourceFileId) {
            continue;
          }
          const result = insert.run(
            `${sourceFileId}:calls:${targetId}`,
            "file",
            sourceFileId,
            "symbol",
            targetId,
            relation,
            1,
          );
          count += result.changes;
        } else if (CBM_IMPORT_EDGE_TYPES.includes(edgeType)) {
          const sourceNode = db
            .prepare(`SELECT file_path FROM cbm_nodes WHERE id = ? AND project = ?`)
            .get(edge.source_id, cbmProjectKey) as { file_path: string } | undefined;
          const targetNode = db
            .prepare(`SELECT file_path FROM cbm_nodes WHERE id = ? AND project = ?`)
            .get(edge.target_id, cbmProjectKey) as { file_path: string } | undefined;
          if (!sourceNode?.file_path || !targetNode?.file_path) {
            continue;
          }
          const sourceFileId = fileIdByPath.get(sourceNode.file_path);
          const targetFileId = fileIdByPath.get(targetNode.file_path);
          if (!sourceFileId || !targetFileId) {
            continue;
          }
          const result = insert.run(
            `${sourceFileId}:imports:${targetFileId}`,
            "file",
            sourceFileId,
            "file",
            targetFileId,
            relation,
            1,
          );
          count += result.changes;
        }
      }
    }
  });
  tx();
  return count;
}

export function rebuildFeatureDependsOn(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
): void {
  const config = loadConfig(projectRoot);
  const allPaths = walkSourceFiles(projectRoot, config.ignore ?? []);
  const features = detectFeatures(allPaths, config);

  const featureIdBySlug = new Map<string, string>();
  for (const row of db
    .prepare(`SELECT id, slug FROM features WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; slug: string }>) {
    featureIdBySlug.set(row.slug, row.id);
  }

  const fileRecords = db
    .prepare(
      `SELECT f.id, f.path, feat.slug AS feature_slug
       FROM files f
       LEFT JOIN features feat ON feat.id = f.feature_id
       WHERE f.project_id = ?`,
    )
    .all(projectId) as Array<{ id: string; path: string; feature_slug: string | null }>;

  const filePathById = new Map(fileRecords.map((f) => [f.id, f.path]));
  const fileImports = new Map<string, string[]>();

  for (const imp of db
    .prepare(
      `SELECT source_id, target_id FROM relations
       WHERE relation = 'imports' AND source_kind = 'file' AND target_kind = 'file'`,
    )
    .all() as Array<{ source_id: string; target_id: string }>) {
    const sourcePath = filePathById.get(imp.source_id);
    const targetPath = filePathById.get(imp.target_id);
    if (!sourcePath || !targetPath) {
      continue;
    }
    const list = fileImports.get(sourcePath) ?? [];
    list.push(targetPath);
    fileImports.set(sourcePath, list);
  }

  const featureDeps = new Map<string, Set<string>>();
  for (const file of fileRecords) {
    if (!file.feature_slug) {
      continue;
    }
    const deps = featureDeps.get(file.feature_slug) ?? new Set<string>();
    for (const imp of fileImports.get(file.path) ?? []) {
      const otherSlug = featureForPath(imp, features);
      if (otherSlug && otherSlug !== file.feature_slug) {
        deps.add(otherSlug);
      }
    }
    featureDeps.set(file.feature_slug, deps);
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO relations (id, source_kind, source_id, target_kind, target_id, relation, weight)
     VALUES (?, 'feature', ?, 'feature', ?, 'depends_on', 1)`,
  );

  for (const feature of features) {
    const featureId = featureIdBySlug.get(feature.slug);
    if (!featureId) {
      continue;
    }
    for (const otherSlug of featureDeps.get(feature.slug) ?? []) {
      const otherId = featureIdBySlug.get(otherSlug);
      if (!otherId) {
        continue;
      }
      insert.run(`${featureId}:depends_on:${otherId}`, featureId, otherId);
    }
  }
}

export function rebuildGraphCaches(
  db: Database.Database,
  projectId: string,
  handle: IndexHandle,
): { symbolCacheCount: number; relationCacheCount: number } {
  const symbolCacheCount = rebuildSymbolCache(db, projectId, handle);
  const relationCacheCount = rebuildRelationCache(db, projectId, handle);
  return { symbolCacheCount, relationCacheCount };
}
