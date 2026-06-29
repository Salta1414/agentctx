import { join } from "node:path";
import Database from "better-sqlite3";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import { openIndexHandle } from "@niryn/indexer-node";
import { cbmProjectKeyFromRoot } from "./db/cbm-bridge.js";
import { getProject, rebuildExportsFromDb } from "./db/rebuild.js";
import { initSchemaV2 } from "./db/schema-v2.js";
import { loadConfig } from "./features/detect.js";
import { isScannablePath } from "./constants/extensions.js";
import { isRepoIgnoredPath } from "./ignore.js";
import {
  rebuildFeatureDependsOn,
  rebuildGraphCaches,
  rebuildNirynRelations,
} from "./indexer/relations.js";
import { writeIndexIgnoreFile } from "./indexer/ignore-bridge.js";
import {
  computeStats,
  rebuildContextRefs,
  removeFileOverlay,
  syncFeatures,
  syncFileOverlay,
  syncTests,
} from "./indexer/overlay.js";
import { normalizeProjectRoot, toPosixPath } from "./utils/paths.js";

export interface IncrementalScanOptions {
  projectRoot: string;
  changedPaths: string[];
  deletedPaths?: string[];
}

export interface IncrementalScanResult {
  projectRoot: string;
  scannedAt: string;
  changed: string[];
  deleted: string[];
  stats: {
    files: number;
    symbols: number;
    features: number;
    tests: number;
  };
  exports: string[];
}

export async function runIncrementalScan(
  options: IncrementalScanOptions,
): Promise<IncrementalScanResult> {
  const projectRoot = normalizeProjectRoot(options.projectRoot);
  const scannedAt = new Date().toISOString();
  const dbPath = join(projectRoot, AGENTCTX_DIR, "context.db");

  const config = loadConfig(projectRoot);
  const ignoredTouched = normalizeIgnoredPaths(
    [...options.changedPaths, ...(options.deletedPaths ?? [])],
    config.ignore ?? [],
  );
  const changed = normalizePaths(options.changedPaths, config.ignore ?? []);
  const deleted = normalizePaths(options.deletedPaths ?? [], config.ignore ?? []);

  const db = new Database(dbPath);
  initSchemaV2(db);

  const project = getProject(db, projectRoot);
  if (!project) {
    db.close();
    throw new Error(`No scan data for ${projectRoot}. Run \`niryn scan\` first.`);
  }

  for (const relPath of ignoredTouched) {
    removeFileOverlay(db, project.id, relPath);
  }

  for (const relPath of deleted) {
    removeFileOverlay(db, project.id, relPath);
  }

  writeIndexIgnoreFile(projectRoot, config.ignore ?? []);

  const handle = openIndexHandle(dbPath, projectRoot, project.id);
  await handle.indexChangedFiles({ changedPaths: changed, deletedPaths: deleted });

  syncFileOverlay(db, project.id, projectRoot, config.ignore ?? []);
  syncFeatures(db, project.id, projectRoot);

  const cbmKey = cbmProjectKeyFromRoot(projectRoot);
  rebuildGraphCaches(db, project.id, handle);
  rebuildNirynRelations(db, project.id, cbmKey);
  rebuildFeatureDependsOn(db, project.id, projectRoot);
  syncTests(db, project.id);
  rebuildContextRefs(db, project.id, scannedAt);

  const exports = rebuildExportsFromDb(db, project.id, projectRoot, scannedAt);

  db.prepare(`UPDATE projects SET last_incremental_scan = ? WHERE id = ?`).run(
    scannedAt,
    project.id,
  );

  const stats = computeStats(db, project.id);
  db.close();
  handle.close();

  return {
    projectRoot,
    scannedAt,
    changed,
    deleted,
    stats,
    exports,
  };
}

function normalizePaths(paths: string[], extraIgnore: string[]): string[] {
  return [
    ...new Set(
      paths
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map((p) => toPosixPath(p))
        .filter((path) => isScannable(path, extraIgnore)),
    ),
  ];
}

function normalizeIgnoredPaths(paths: string[], extraIgnore: string[]): string[] {
  return [
    ...new Set(
      paths
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map((p) => toPosixPath(p))
        .filter((path) => isRepoIgnoredPath(path, extraIgnore)),
    ),
  ];
}

function isScannable(path: string, extraIgnore: string[]): boolean {
  return isScannablePath(path) && !isRepoIgnoredPath(path, extraIgnore);
}
