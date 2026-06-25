import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import {
  deleteProjectRelations,
  getProject,
  rebuildExportsFromDb,
  rebuildRelations,
} from "./db/rebuild.js";
import { initSchema } from "./db/schema.js";
import {
  detectFeatures,
  featureForPath,
  loadConfig,
} from "./features/detect.js";
import { isScannablePath } from "./constants/extensions.js";
import { isRepoIgnoredPath } from "./ignore.js";
import { parseSource } from "./parse/index.js";
import { sha256 } from "./utils/hash.js";
import {
  isTestPath,
  languageFromPath,
  normalizeProjectRoot,
  toPosixPath,
} from "./utils/paths.js";
import { walkSourceFiles } from "./walk/files.js";

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

export function runIncrementalScan(
  options: IncrementalScanOptions,
): IncrementalScanResult {
  const projectRoot = normalizeProjectRoot(options.projectRoot);
  const scannedAt = new Date().toISOString();
  const dbPath = join(projectRoot, AGENTCTX_DIR, "context.db");

  const config = loadConfig(projectRoot);
  const ignoredTouched = normalizeIgnoredPaths([
    ...options.changedPaths,
    ...(options.deletedPaths ?? []),
  ], config.ignore ?? []);
  const changed = normalizePaths(options.changedPaths, config.ignore ?? []);
  const deleted = normalizePaths(options.deletedPaths ?? [], config.ignore ?? []);

  const db = new Database(dbPath);
  initSchema(db);

  const project = getProject(db, projectRoot);
  if (!project) {
    db.close();
    throw new Error(`No scan data for ${projectRoot}. Run \`niryn scan\` first.`);
  }

  purgeIgnoredFiles(db, project.id, config.ignore ?? []);
  syncFeatures(db, project.id, projectRoot, config);

  for (const relPath of ignoredTouched) {
    removeFile(db, project.id, relPath);
  }

  for (const relPath of deleted) {
    removeFile(db, project.id, relPath);
  }

  for (const relPath of changed) {
    if (!isScannable(relPath, config.ignore ?? [])) continue;
    const abs = join(projectRoot, relPath);
    if (!existsSync(abs)) {
      removeFile(db, project.id, relPath);
      continue;
    }
    upsertFile(db, project.id, projectRoot, relPath, config, scannedAt);
  }

  rebuildRelations(db, project.id, projectRoot);
  const exports = rebuildExportsFromDb(db, project.id, projectRoot, scannedAt);

  db.prepare(`UPDATE projects SET last_incremental_scan = ? WHERE id = ?`).run(
    scannedAt,
    project.id,
  );

  const stats = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM files WHERE project_id = ?) as files,
         (SELECT COUNT(*) FROM symbols s JOIN files f ON f.id = s.file_id WHERE f.project_id = ?) as symbols,
         (SELECT COUNT(*) FROM features WHERE project_id = ?) as features,
         (SELECT COUNT(*) FROM tests t JOIN files f ON f.id = t.file_id WHERE f.project_id = ?) as tests`,
    )
    .get(project.id, project.id, project.id, project.id) as {
    files: number;
    symbols: number;
    features: number;
    tests: number;
  };

  db.close();

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
        .map((p) => toPosixPath(p))
        .filter((path) => isScannable(path, extraIgnore)),
    ),
  ];
}

function normalizeIgnoredPaths(paths: string[], extraIgnore: string[]): string[] {
  return [
    ...new Set(
      paths
        .map((p) => toPosixPath(p))
        .filter((path) => isRepoIgnoredPath(path, extraIgnore)),
    ),
  ];
}

function isScannable(path: string, extraIgnore: string[]): boolean {
  return isScannablePath(path) && !isRepoIgnoredPath(path, extraIgnore);
}

function purgeIgnoredFiles(
  db: Database.Database,
  projectId: string,
  extraIgnore: string[],
) {
  const files = db
    .prepare(`SELECT path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ path: string }>;
  for (const file of files) {
    if (isRepoIgnoredPath(file.path, extraIgnore)) {
      removeFile(db, projectId, file.path);
    }
  }
}

function syncFeatures(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
  config: ReturnType<typeof loadConfig>,
) {
  const allPaths = walkSourceFiles(projectRoot, config.ignore ?? []);
  const features = detectFeatures(allPaths, config);

  const existing = db
    .prepare(`SELECT id, slug FROM features WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; slug: string }>;
  const bySlug = new Map(existing.map((f) => [f.slug, f.id]));

  const insertFeature = db.prepare(
    `INSERT INTO features (id, project_id, slug, name, detection, entrypoint_file_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const feature of features) {
    if (!bySlug.has(feature.slug)) {
      const id = crypto.randomUUID();
      insertFeature.run(
        id,
        projectId,
        feature.slug,
        feature.name,
        feature.detection,
        null,
      );
      bySlug.set(feature.slug, id);
    }
  }

  const featureIdBySlug = bySlug;
  for (const file of db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>) {
    const slug = featureForPath(file.path, features);
    const featureId = slug ? featureIdBySlug.get(slug) ?? null : null;
    db.prepare(`UPDATE files SET feature_id = ? WHERE id = ?`).run(featureId, file.id);

    if (slug) {
      const feat = features.find((f) => f.slug === slug);
      if (feat?.entrypoint === file.path && featureId) {
        db.prepare(`UPDATE features SET entrypoint_file_id = ? WHERE id = ?`).run(
          file.id,
          featureId,
        );
      }
    }
  }
}

function removeFile(db: Database.Database, projectId: string, relPath: string) {
  const file = db
    .prepare(`SELECT id FROM files WHERE project_id = ? AND path = ?`)
    .get(projectId, relPath) as { id: string } | undefined;
  if (!file) return;

  const symbolIds = db
    .prepare(`SELECT id FROM symbols WHERE file_id = ?`)
    .all(file.id)
    .map((r) => (r as { id: string }).id);

  const ids = [file.id, ...symbolIds];
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM relations WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
  ).run(...ids, ...ids);

  db.prepare(`DELETE FROM tests WHERE file_id = ?`).run(file.id);
  db.prepare(`DELETE FROM symbols WHERE file_id = ?`).run(file.id);
  db.prepare(`DELETE FROM context_refs WHERE path = ?`).run(relPath);
  db.prepare(`DELETE FROM files WHERE id = ?`).run(file.id);
}

function upsertFile(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
  relPath: string,
  config: ReturnType<typeof loadConfig>,
  scannedAt: string,
) {
  const absPath = join(projectRoot, relPath);
  const source = readFileSync(absPath, "utf8");
  const contentHash = sha256(source);
  const stat = statSync(absPath);
  const allPaths = walkSourceFiles(projectRoot, config.ignore ?? []);
  const features = detectFeatures(allPaths, config);
  const featureSlug = featureForPath(relPath, features);
  const featureId = featureSlug
    ? (
        db
          .prepare(`SELECT id FROM features WHERE project_id = ? AND slug = ?`)
          .get(projectId, featureSlug) as { id: string } | undefined
      )?.id ?? null
    : null;
  const isTest = isTestPath(relPath);
  const isEntry =
    relPath.endsWith("/index.ts") || relPath.endsWith("/index.tsx") ? 1 : 0;

  let existing = db
    .prepare(`SELECT id, project_id FROM files WHERE project_id = ? AND path = ?`)
    .get(projectId, relPath) as { id: string; project_id: string } | undefined;

  if (!existing) {
    const byPath = db
      .prepare(`SELECT id, project_id FROM files WHERE path = ?`)
      .get(relPath) as { id: string; project_id: string } | undefined;
    if (byPath && byPath.project_id !== projectId) {
      removeFile(db, byPath.project_id, relPath);
    } else {
      existing = byPath;
    }
  }

  let fileId = existing?.id;

  if (fileId) {
    db.prepare(
      `UPDATE files SET content_hash = ?, is_test = ?, is_entrypoint = ?,
       feature_id = ?, last_modified = ?, language = ?
       WHERE id = ?`,
    ).run(
      contentHash,
      isTest ? 1 : 0,
      isEntry,
      featureId,
      stat.mtime.toISOString(),
      languageFromPath(relPath),
      fileId,
    );

    const oldSymbols = db
      .prepare(`SELECT id FROM symbols WHERE file_id = ?`)
      .all(fileId) as Array<{ id: string }>;
    const oldIds = oldSymbols.map((s) => s.id);
    if (oldIds.length > 0) {
      const ph = oldIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM relations WHERE source_id IN (${ph}) OR target_id IN (${ph})`,
      ).run(...oldIds, ...oldIds);
    }
    db.prepare(`DELETE FROM symbols WHERE file_id = ?`).run(fileId);
    db.prepare(`DELETE FROM tests WHERE file_id = ?`).run(fileId);
    db.prepare(`DELETE FROM context_refs WHERE path = ?`).run(relPath);
  } else {
    fileId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO files (id, project_id, path, language, content_hash, is_test, is_entrypoint, feature_id, last_modified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fileId,
      projectId,
      relPath,
      languageFromPath(relPath),
      contentHash,
      isTest ? 1 : 0,
      isEntry,
      featureId,
      stat.mtime.toISOString(),
    );
  }

  const parsed = parseSource(relPath, source);
  const insertSymbol = db.prepare(
    `INSERT INTO symbols (id, file_id, name, kind, signature, body_hash, exported, start_line, end_line)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRef = db.prepare(
    `INSERT INTO context_refs (id, path, symbol, signature, content_hash, status, purpose, last_verified)
     VALUES (?, ?, ?, ?, ?, 'valid', ?, ?)`,
  );

  for (const sym of parsed.symbols) {
    const symbolId = crypto.randomUUID();
    const bodyHash = sha256(sym.bodyText);
    insertSymbol.run(
      symbolId,
      fileId,
      sym.name,
      sym.kind,
      sym.signature,
      bodyHash,
      sym.exported ? 1 : 0,
      sym.startLine,
      sym.endLine,
    );

    if (sym.exported) {
      insertRef.run(
        crypto.randomUUID(),
        relPath,
        sym.name,
        sym.signature,
        bodyHash,
        `${sym.kind} exported from ${relPath}`,
        scannedAt,
      );
    }
  }

  if (isTest && parsed.testFramework) {
    db.prepare(
      `INSERT INTO tests (id, file_id, framework, covers_feature_id, covers_symbol_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), fileId, parsed.testFramework, featureId, null);
  }

  if (featureSlug) {
    const feat = features.find((f) => f.slug === featureSlug);
    if (feat?.entrypoint === relPath && featureId) {
      db.prepare(`UPDATE features SET entrypoint_file_id = ? WHERE id = ?`).run(
        fileId,
        featureId,
      );
    }
  }
}
