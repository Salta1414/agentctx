import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { cbmProjectKeyFromRoot } from "../db/cbm-bridge.js";
import {
  detectFeatures,
  featureForPath,
  loadConfig,
  type DetectedFeature,
} from "../features/detect.js";
import { isRepoIgnoredPath } from "../ignore.js";
import { sha256 } from "../utils/hash.js";
import { isTestPath, languageFromPath, toPosixPath } from "../utils/paths.js";
import { walkSourceFiles } from "../walk/files.js";

export const SCAN_SPEC_VERSION = "2.0.0";

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/** Legacy v1: symbols populated but no CBM index for this project. */
export function detectLegacyV1(db: Database.Database, projectRoot: string): boolean {
  if (!tableExists(db, "symbols")) {
    return false;
  }
  const symCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM symbols`).get() as { c: number }
  ).c;
  if (symCount === 0) {
    return false;
  }
  if (!tableExists(db, "cbm_nodes")) {
    return true;
  }
  const cbmKey = cbmProjectKeyFromRoot(projectRoot);
  const cbmCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM cbm_nodes WHERE project = ?`).get(cbmKey) as {
      c: number;
    }
  ).c;
  return cbmCount === 0;
}

export function resolveProjectId(
  db: Database.Database,
  projectRoot: string,
): string {
  const existing = db
    .prepare(`SELECT id FROM projects WHERE root_path = ?`)
    .get(projectRoot) as { id: string } | undefined;
  return existing?.id ?? crypto.randomUUID();
}

export function syncFileOverlay(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
  ignore: string[] = [],
): number {
  const project = db
    .prepare(`SELECT cbm_project_key FROM projects WHERE id = ?`)
    .get(projectId) as { cbm_project_key: string | null } | undefined;
  const cbmKey = project?.cbm_project_key ?? cbmProjectKeyFromRoot(projectRoot);

  const paths = new Set<string>();
  if (tableExists(db, "cbm_nodes")) {
    const rows = db
      .prepare(
        `SELECT DISTINCT file_path AS path FROM cbm_nodes
         WHERE project = ? AND file_path IS NOT NULL AND file_path != ''`,
      )
      .all(cbmKey) as Array<{ path: string }>;
    for (const row of rows) {
      if (typeof row.path !== "string" || !row.path) continue;
      paths.add(toPosixPath(row.path));
    }
  }
  if (tableExists(db, "cbm_file_hashes")) {
    const rows = db
      .prepare(`SELECT rel_path AS path FROM cbm_file_hashes WHERE project = ?`)
      .all(cbmKey) as Array<{ path: string }>;
    for (const row of rows) {
      if (typeof row.path !== "string" || !row.path) continue;
      paths.add(toPosixPath(row.path));
    }
  }

  const upsert = db.prepare(
    `INSERT INTO files (id, project_id, path, language, content_hash, is_test, is_entrypoint, feature_id, last_modified)
     VALUES (@id, @projectId, @path, @language, @contentHash, @isTest, 0, NULL, @lastModified)
     ON CONFLICT(project_id, path) DO UPDATE SET
       language = excluded.language,
       content_hash = excluded.content_hash,
       is_test = excluded.is_test,
       last_modified = excluded.last_modified`,
  );

  const existingByPath = new Map<string, string>();
  for (const row of db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>) {
    existingByPath.set(row.path, row.id);
  }

  let count = 0;
  const tx = db.transaction(() => {
    for (const relPath of paths) {
      if (isRepoIgnoredPath(relPath, ignore)) {
        continue;
      }
      const absPath = join(projectRoot, relPath);
      let contentHash = "";
      let lastModified = new Date().toISOString();
      try {
        const source = readFileSync(absPath, "utf8");
        contentHash = sha256(source);
        lastModified = statSync(absPath).mtime.toISOString();
      } catch {
        /* skip unreadable paths */
        continue;
      }
      const id = existingByPath.get(relPath) ?? crypto.randomUUID();
      upsert.run({
        id,
        projectId,
        path: relPath,
        language: languageFromPath(relPath),
        contentHash,
        isTest: isTestPath(relPath) ? 1 : 0,
        lastModified,
      });
      count += 1;
    }
  });
  tx();
  return count;
}

export function removeFileOverlay(
  db: Database.Database,
  projectId: string,
  relPath: string,
): void {
  const file = db
    .prepare(`SELECT id FROM files WHERE project_id = ? AND path = ?`)
    .get(projectId, relPath) as { id: string } | undefined;
  if (!file) {
    return;
  }
  db.prepare(`DELETE FROM tests WHERE file_id = ?`).run(file.id);
  db.prepare(`DELETE FROM context_refs WHERE path = ?`).run(relPath);
  db.prepare(`DELETE FROM files WHERE id = ?`).run(file.id);
}

export function computeStats(
  db: Database.Database,
  projectId: string,
  cbmCounts?: { nodeCount?: number; edgeCount?: number },
): {
  files: number;
  symbols: number;
  features: number;
  tests: number;
  cbm_nodes?: number;
  cbm_edges?: number;
} {
  const files = (
    db.prepare(`SELECT COUNT(*) AS c FROM files WHERE project_id = ?`).get(projectId) as {
      c: number;
    }
  ).c;
  const symbols = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM niryn_symbol_cache WHERE project_id = ?`)
      .get(projectId) as { c: number }
  ).c;
  const features = (
    db.prepare(`SELECT COUNT(*) AS c FROM features WHERE project_id = ?`).get(projectId) as {
      c: number;
    }
  ).c;
  const tests = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM tests t
         JOIN files f ON f.id = t.file_id
         WHERE f.project_id = ?`,
      )
      .get(projectId) as { c: number }
  ).c;

  let cbm_nodes = cbmCounts?.nodeCount;
  let cbm_edges = cbmCounts?.edgeCount;

  if (cbm_nodes == null || cbm_edges == null) {
    const project = db
      .prepare(`SELECT cbm_project_key FROM projects WHERE id = ?`)
      .get(projectId) as { cbm_project_key: string | null } | undefined;
    const cbmKey = project?.cbm_project_key;
    if (cbmKey && tableExists(db, "cbm_nodes")) {
      if (cbm_nodes == null) {
        cbm_nodes = (
          db.prepare(`SELECT COUNT(*) AS c FROM cbm_nodes WHERE project = ?`).get(cbmKey) as {
            c: number;
          }
        ).c;
      }
      if (cbm_edges == null && tableExists(db, "cbm_edges")) {
        cbm_edges = (
          db.prepare(`SELECT COUNT(*) AS c FROM cbm_edges WHERE project = ?`).get(cbmKey) as {
            c: number;
          }
        ).c;
      }
    }
  }

  return {
    files,
    symbols,
    features,
    tests,
    ...(cbm_nodes != null ? { cbm_nodes } : {}),
    ...(cbm_edges != null ? { cbm_edges } : {}),
  };
}

export function syncTests(db: Database.Database, projectId: string): void {
  db.prepare(
    `DELETE FROM tests WHERE file_id IN (SELECT id FROM files WHERE project_id = ?)`,
  ).run(projectId);

  const insert = db.prepare(
    `INSERT INTO tests (id, file_id, framework, covers_feature_id, covers_symbol_id)
     VALUES (?, ?, ?, ?, NULL)`,
  );

  const testFiles = db
    .prepare(`SELECT id, feature_id FROM files WHERE project_id = ? AND is_test = 1`)
    .all(projectId) as Array<{ id: string; feature_id: string | null }>;

  for (const file of testFiles) {
    insert.run(crypto.randomUUID(), file.id, "heuristic", file.feature_id);
  }
}

export function rebuildContextRefs(
  db: Database.Database,
  projectId: string,
  scannedAt: string,
): void {
  db.prepare(`DELETE FROM context_refs`).run();

  const insert = db.prepare(
    `INSERT INTO context_refs (id, path, symbol, signature, content_hash, status, purpose, last_verified)
     VALUES (?, ?, ?, ?, ?, 'valid', ?, ?)`,
  );

  const files = db
    .prepare(`SELECT path, content_hash FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ path: string; content_hash: string }>;

  for (const file of files) {
    insert.run(
      crypto.randomUUID(),
      file.path,
      null,
      file.path,
      file.content_hash,
      `file ${file.path}`,
      scannedAt,
    );
  }

  if (!tableExists(db, "niryn_symbol_cache")) {
    return;
  }

  const rows = db
    .prepare(
      `SELECT s.name, s.kind, s.signature, s.file_path, f.content_hash
       FROM niryn_symbol_cache s
       JOIN files f ON f.path = s.file_path AND f.project_id = s.project_id
       WHERE s.project_id = ? AND s.exported = 1`,
    )
    .all(projectId) as Array<{
    name: string;
    kind: string;
    signature: string | null;
    file_path: string;
    content_hash: string;
  }>;

  for (const row of rows) {
    insert.run(
      crypto.randomUUID(),
      row.file_path,
      row.name,
      row.signature ?? row.name,
      row.content_hash,
      `${row.kind} exported from ${row.file_path}`,
      scannedAt,
    );
  }
}

export function syncFeatures(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
): DetectedFeature[] {
  const config = loadConfig(projectRoot);
  const allPaths = walkSourceFiles(projectRoot, config.ignore ?? []);
  const features = detectFeatures(allPaths, config);

  const existing = db
    .prepare(`SELECT id, slug FROM features WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; slug: string }>;
  const bySlug = new Map(existing.map((f) => [f.slug, f.id]));

  const insertFeature = db.prepare(
    `INSERT INTO features (id, project_id, slug, name, detection, entrypoint_file_id)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );

  for (const feature of features) {
    if (!bySlug.has(feature.slug)) {
      const id = crypto.randomUUID();
      insertFeature.run(id, projectId, feature.slug, feature.name, feature.detection);
      bySlug.set(feature.slug, id);
    }
  }

  const updateFile = db.prepare(`UPDATE files SET feature_id = ? WHERE id = ?`);
  const entryStmt = db.prepare(`UPDATE features SET entrypoint_file_id = ? WHERE id = ?`);

  for (const file of db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>) {
    const slug = featureForPath(file.path, features);
    const featureId = slug ? (bySlug.get(slug) ?? null) : null;
    updateFile.run(featureId, file.id);
    if (slug) {
      const feat = features.find((f) => f.slug === slug);
      if (feat?.entrypoint === file.path && featureId) {
        db.prepare(`UPDATE files SET is_entrypoint = 1 WHERE id = ?`).run(file.id);
        entryStmt.run(file.id, featureId);
      }
    }
  }

  return features;
}
