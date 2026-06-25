import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  exportProfileForSymbolCount,
  SCAN_EXPORT_LIMITS,
} from "../constants/export-limits.js";
import {
  detectFeatures,
  featureForPath,
  loadConfig,
  type DetectedFeature,
} from "../features/detect.js";
import { writeExports, type ExportSymbol } from "../exports/write.js";
import { getGitContext } from "../git/context.js";
import { isRepoIgnoredPath } from "../ignore.js";
import { parseSource } from "../parse/index.js";
import {
  isTestPath,
  resolveImportPath,
  toPosixPath,
} from "../utils/paths.js";
import { walkSourceFiles } from "../walk/files.js";

interface ProjectRow {
  id: string;
  root_path: string;
  name: string;
  stack: string;
  last_full_scan: string;
  last_incremental_scan: string | null;
}

export function getProject(
  db: Database.Database,
  projectRoot: string,
): ProjectRow | undefined {
  return db
    .prepare(
      `SELECT id, root_path, name, stack, last_full_scan, last_incremental_scan
       FROM projects WHERE root_path = ?`,
    )
    .get(projectRoot) as ProjectRow | undefined;
}

export function deleteProjectRelations(db: Database.Database, projectId: string) {
  const fileIds = db
    .prepare(`SELECT id FROM files WHERE project_id = ?`)
    .all(projectId)
    .map((r) => (r as { id: string }).id);
  const symbolIds = db
    .prepare(
      `SELECT s.id FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE f.project_id = ?`,
    )
    .all(projectId)
    .map((r) => (r as { id: string }).id);
  const featureIds = db
    .prepare(`SELECT id FROM features WHERE project_id = ?`)
    .all(projectId)
    .map((r) => (r as { id: string }).id);

  const ids = [...fileIds, ...symbolIds, ...featureIds];
  if (ids.length === 0) return;

  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM relations
     WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
  ).run(...ids, ...ids);
}

export function rebuildRelations(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
) {
  deleteProjectRelations(db, projectId);

  const insertRelation = db.prepare(
    `INSERT INTO relations (id, source_kind, source_id, target_kind, target_id, relation, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const config = loadConfig(projectRoot);
  const files = (db
    .prepare(`SELECT id, path FROM files WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; path: string }>).filter(
    (file) => !isRepoIgnoredPath(file.path, config.ignore ?? []),
  );

  const fileIdByPath = new Map(files.map((f) => [f.path, f.id]));

  const symbols = (db
    .prepare(
      `SELECT s.id, s.name, f.path as file_path
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE f.project_id = ?`,
    )
    .all(projectId) as Array<{ id: string; name: string; file_path: string }>).filter(
    (symbol) => !isRepoIgnoredPath(symbol.file_path, config.ignore ?? []),
  );

  const symbolIdsByName = new Map<string, string[]>();
  for (const sym of symbols) {
    const list = symbolIdsByName.get(sym.name) ?? [];
    list.push(sym.id);
    symbolIdsByName.set(sym.name, list);
  }

  const fileImports = new Map<string, string[]>();
  const fileRecords: Array<{ path: string; featureSlug: string | null }> = [];

  const allPaths = walkSourceFiles(projectRoot, config.ignore ?? []);
  const features = detectFeatures(allPaths, config);

  for (const file of files) {
    const absPath = join(projectRoot, file.path);
    const source = readFileSync(absPath, "utf8");
    const parsed = parseSource(file.path, source);
    const featureSlug = featureForPath(file.path, features);

    fileRecords.push({ path: file.path, featureSlug });

    const resolvedImports: string[] = [];
    for (const imp of parsed.imports) {
      const resolved = resolveImportPath(absPath, imp.specifier, projectRoot);
      if (resolved && !isRepoIgnoredPath(resolved, config.ignore ?? [])) {
        resolvedImports.push(resolved);
      }
      const targetFileId = resolved ? fileIdByPath.get(resolved) : undefined;
      if (targetFileId) {
        insertRelation.run(
          crypto.randomUUID(),
          "file",
          file.id,
          "file",
          targetFileId,
          "imports",
          1,
        );
      }
    }
    fileImports.set(file.path, resolvedImports);

    for (const call of parsed.calls) {
      const targetIds = symbolIdsByName.get(call.name) ?? [];
      for (const targetId of targetIds) {
        insertRelation.run(
          crypto.randomUUID(),
          "file",
          file.id,
          "symbol",
          targetId,
          "calls",
          1,
        );
      }
    }
  }

  const featureIdBySlug = new Map(
    (
      db
        .prepare(`SELECT id, slug FROM features WHERE project_id = ?`)
        .all(projectId) as Array<{ id: string; slug: string }>
    ).map((f) => [f.slug, f.id]),
  );

  for (const feature of features) {
    const featureId = featureIdBySlug.get(feature.slug);
    if (!featureId) continue;
    for (const other of features) {
      if (other.slug === feature.slug) continue;
      const importsOther = fileRecords.some((f) => {
        if (f.featureSlug !== feature.slug) return false;
        return (fileImports.get(f.path) ?? []).some(
          (imp) => featureForPath(imp, features) === other.slug,
        );
      });
      if (importsOther) {
        const otherId = featureIdBySlug.get(other.slug);
        if (otherId) {
          insertRelation.run(
            crypto.randomUUID(),
            "feature",
            featureId,
            "feature",
            otherId,
            "depends_on",
            1,
          );
        }
      }
    }
  }
}

export function rebuildExportsFromDb(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
  scannedAt: string,
): string[] {
  const project = db
    .prepare(
      `SELECT name, stack, last_full_scan, last_incremental_scan FROM projects WHERE id = ?`,
    )
    .get(projectId) as {
    name: string;
    stack: string;
    last_full_scan: string;
    last_incremental_scan: string | null;
  };

  const features = db
    .prepare(
      `SELECT f.id, f.slug, f.name, f.detection, fi.path as entrypoint
       FROM features f
       LEFT JOIN files fi ON fi.id = f.entrypoint_file_id
       WHERE f.project_id = ?`,
    )
    .all(projectId) as Array<{
    id: string;
    slug: string;
    name: string;
    detection: string;
    entrypoint: string | null;
  }>;

  const config = loadConfig(projectRoot);
  const files = (db
    .prepare(
      `SELECT f.id, f.path, f.is_test, feat.slug as feature_slug
       FROM files f
       LEFT JOIN features feat ON feat.id = f.feature_id
       WHERE f.project_id = ?`,
    )
    .all(projectId) as Array<{
    id: string;
    path: string;
    is_test: number;
    feature_slug: string | null;
  }>).filter((file) => !isRepoIgnoredPath(file.path, config.ignore ?? []));

  const symbols = (db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.signature, s.body_hash, s.exported,
              f.path as file_path
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE f.project_id = ?`,
    )
    .all(projectId) as Array<{
    id: string;
    name: string;
    kind: string;
    signature: string;
    body_hash: string;
    exported: number;
    file_path: string;
    file_id?: string;
  }>).filter((symbol) => !isRepoIgnoredPath(symbol.file_path, config.ignore ?? []));

  const relations = db.prepare(`SELECT source_id, target_id, relation FROM relations`).all() as Array<{
    source_id: string;
    target_id: string;
    relation: string;
  }>;

  const fileIdToPath = new Map(files.map((f) => [f.id, f.path]));
  const profile = exportProfileForSymbolCount(symbols.length);
  const calledBy = new Map<string, Set<string>>();

  if (profile === "full") {
    for (const rel of relations) {
      if (rel.relation !== "calls") continue;
      const callerPath = fileIdToPath.get(rel.source_id);
      if (!callerPath) continue;
      const set = calledBy.get(rel.target_id) ?? new Set();
      if (set.size >= SCAN_EXPORT_LIMITS.CALLED_BY_MAX) continue;
      set.add(callerPath);
      calledBy.set(rel.target_id, set);
    }
  }

  const exportSymbols: ExportSymbol[] = symbols.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    path: s.file_path,
    signature: s.signature,
    content_hash: s.body_hash,
    exported: s.exported === 1,
    called_by: [...(calledBy.get(s.id) ?? [])],
    imports_from: [],
  }));

  const dependsByFeature = new Map<string, string[]>();
  const featureSlugById = new Map(features.map((f) => [f.id, f.slug]));
  for (const rel of db
    .prepare(
      `SELECT source_id, target_id FROM relations WHERE relation = 'depends_on'`,
    )
    .all() as Array<{ source_id: string; target_id: string }>) {
    const sourceSlug = featureSlugById.get(rel.source_id);
    const targetSlug = featureSlugById.get(rel.target_id);
    if (!sourceSlug || !targetSlug) continue;
    const list = dependsByFeature.get(sourceSlug) ?? [];
    list.push(targetSlug);
    dependsByFeature.set(sourceSlug, list);
  }

  const detectedFeatures: DetectedFeature[] = features.map((f) => ({
    slug: f.slug,
    name: f.name,
    detection: f.detection as DetectedFeature["detection"],
    paths: files
      .filter((file) => file.feature_slug === f.slug)
      .map((file) => file.path),
    entrypoint: f.entrypoint ?? undefined,
    depends_on: [...new Set(dependsByFeature.get(f.slug) ?? [])].sort(),
  }));

  const featureIdBySlug = new Map(features.map((f) => [f.slug, f.id]));

  const stats = {
    files: files.length,
    symbols: symbols.length,
    features: features.length,
    tests: files.filter((f) => f.is_test === 1).length,
  };

  const written = writeExports({
    projectRoot,
    projectName: project.name,
    scannedAt: project.last_full_scan,
    lastIncrementalScan: scannedAt,
    stack: JSON.parse(project.stack) as string[],
    features: detectedFeatures,
    featureIdBySlug,
    files: files.map((f) => ({
      id: f.id,
      path: f.path,
      feature_slug: f.feature_slug,
      is_test: f.is_test === 1,
    })),
    symbols: exportSymbols,
    symbolCount: symbols.length,
    exportedSymbolCount: symbols.filter((s) => s.exported === 1).length,
    symbolNameIndex: new Map(),
    relations: [],
    stats,
    git: getGitContext(projectRoot),
  });

  return written;
}
