import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import { indexProject, openIndexHandle } from "@niryn/indexer-node";
import { cbmProjectKeyFromRoot, ensureProjectRow } from "./db/cbm-bridge.js";
import { rebuildExportsFromDb } from "./db/rebuild.js";
import { initSchemaV2 } from "./db/schema-v2.js";
import { detectFeatures, loadConfig } from "./features/detect.js";
import {
  assignFileFeatures,
  rebuildFeatureDependsOn,
  rebuildGraphCaches,
  rebuildNirynRelations,
} from "./indexer/relations.js";
import { writeIndexIgnoreFile } from "./indexer/ignore-bridge.js";
import {
  computeStats,
  detectLegacyV1,
  rebuildContextRefs,
  resolveProjectId,
  SCAN_SPEC_VERSION,
  syncFileOverlay,
  syncTests,
} from "./indexer/overlay.js";
import { dropLegacyTables, migrateV1ToV2, remapFeatureEntrypoints } from "./migrate/v1-to-v2.js";
import { detectStack, projectName } from "./stack/detect.js";
import { normalizeProjectRoot } from "./utils/paths.js";
import { walkSourceFiles } from "./walk/files.js";

export interface ScanProgress {
  phase: "discover" | "index" | "features" | "export";
  current: number;
  total: number;
  label?: string;
}

export interface ScanOptions {
  projectRoot: string;
  full?: boolean;
  onProgress?: (progress: ScanProgress) => void;
}

function shouldEmitProgress(): boolean {
  return process.env.NIRYN_SCAN_PROGRESS === "1";
}

function emitScanProgress(
  progress: ScanProgress,
  onProgress?: ScanOptions["onProgress"],
): void {
  onProgress?.(progress);
  if (shouldEmitProgress()) {
    process.stderr.write(`NIRYN_PROGRESS:${JSON.stringify(progress)}\n`);
  }
}

export interface ScanResult {
  projectRoot: string;
  agentCtxDir: string;
  specVersion: string;
  status: "complete" | "error";
  message: string;
  stats: {
    files: number;
    symbols: number;
    features: number;
    tests: number;
  };
  exports: string[];
}

export async function runScan(options: ScanOptions): Promise<ScanResult> {
  const projectRoot = normalizeProjectRoot(options.projectRoot);
  const agentDir = join(projectRoot, AGENTCTX_DIR);
  const dbPath = join(agentDir, "context.db");
  const scannedAt = new Date().toISOString();

  mkdirSync(join(agentDir, "maps"), { recursive: true });
  mkdirSync(join(agentDir, "refs"), { recursive: true });

  const config = loadConfig(projectRoot);
  const filePaths = walkSourceFiles(projectRoot, config.ignore ?? []);
  emitScanProgress(
    {
      phase: "discover",
      current: filePaths.length,
      total: filePaths.length,
      label: `${filePaths.length} source files`,
    },
    options.onProgress,
  );

  const stack = detectStack(projectRoot);
  const name = projectName(projectRoot);
  const db = new Database(dbPath);
  initSchemaV2(db);

  const legacyV1 = detectLegacyV1(db, projectRoot);
  if (legacyV1) {
    const migration = migrateV1ToV2(db, projectRoot);
    emitScanProgress(
      {
        phase: "index",
        current: 0,
        total: 1,
        label: migration.message,
      },
      options.onProgress,
    );
  }

  const forceFull = legacyV1 || (options.full ?? true);
  const projectId = resolveProjectId(db, projectRoot);

  ensureProjectRow(db, {
    id: projectId,
    rootPath: projectRoot,
    name,
    specVersion: SCAN_SPEC_VERSION,
    indexerVersion: "niryn-indexer-0.2.0",
  });
  db.prepare(
    `UPDATE projects SET stack = ?, name = ?, spec_version = ?, last_full_scan = ? WHERE id = ?`,
  ).run(JSON.stringify(stack), name, SCAN_SPEC_VERSION, scannedAt, projectId);
  db.close();

  emitScanProgress(
    { phase: "index", current: 0, total: 1, label: "CBM index" },
    options.onProgress,
  );

  writeIndexIgnoreFile(projectRoot, config.ignore ?? []);

  const indexResult = await indexProject({
    dbPath,
    projectRoot,
    projectId,
    full: forceFull,
  });

  emitScanProgress(
    {
      phase: "index",
      current: 1,
      total: 1,
      label: `${indexResult.nodeCount} nodes, ${indexResult.edgeCount} edges`,
    },
    options.onProgress,
  );

  const handle = openIndexHandle(dbPath, projectRoot, projectId);
  const db2 = new Database(dbPath);
  const cbmKey = cbmProjectKeyFromRoot(projectRoot);

  syncFileOverlay(db2, projectId, projectRoot, config.ignore ?? []);
  if (legacyV1) {
    remapFeatureEntrypoints(db2, projectId);
  }

  emitScanProgress(
    { phase: "features", current: 0, total: 1, label: "Detecting features" },
    options.onProgress,
  );

  const features = detectFeatures(filePaths, config);
  assignFileFeatures(db2, projectId, projectRoot, features);

  rebuildGraphCaches(db2, projectId, handle);
  rebuildNirynRelations(db2, projectId, cbmKey);
  rebuildFeatureDependsOn(db2, projectId, projectRoot);
  syncTests(db2, projectId);
  rebuildContextRefs(db2, projectId, scannedAt);

  emitScanProgress(
    { phase: "export", current: 0, total: 1, label: "Writing graph exports" },
    options.onProgress,
  );

  const exports = rebuildExportsFromDb(db2, projectId, projectRoot, scannedAt);
  const stats = computeStats(db2, projectId);

  if (legacyV1) {
    dropLegacyTables(db2);
  }

  emitScanProgress(
    { phase: "export", current: 1, total: 1, label: "Finalizing graph" },
    options.onProgress,
  );

  db2.close();
  handle.close();

  return {
    projectRoot,
    agentCtxDir: agentDir,
    specVersion: SCAN_SPEC_VERSION,
    status: "complete",
    message: `Scanned ${stats.files} files, ${stats.symbols} symbols, ${stats.features} features`,
    stats,
    exports,
  };
}
