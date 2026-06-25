import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AGENTCTX_DIR, SPEC_VERSION } from "@niryn/agentctx-spec";
import { clearProjectData, initSchema } from "./db/schema.js";
import {
  detectFeatures,
  featureForPath,
  loadConfig,
} from "./features/detect.js";
import {
  exportProfileForSymbolCount,
  SCAN_EXPORT_LIMITS,
} from "./constants/export-limits.js";
import { getGitContext } from "./git/context.js";
import { writeExports, type ExportSymbol } from "./exports/write.js";
import { parseSource } from "./parse/index.js";
import { detectStack, projectName } from "./stack/detect.js";
import { sha256 } from "./utils/hash.js";
import {
  isTestPath,
  languageFromPath,
  normalizeProjectRoot,
  resolveImportPath,
  toPosixPath,
} from "./utils/paths.js";
import { walkSourceFiles } from "./walk/files.js";

export interface ScanProgress {
  phase: "discover" | "parse" | "export";
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

interface FileRecord {
  id: string;
  path: string;
  featureSlug: string | null;
  isTest: boolean;
}

interface SymbolRecord {
  id: string;
  fileId: string;
  filePath: string;
  name: string;
  kind: string;
  signature: string;
  bodyHash: string;
  exported: boolean;
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
  const features = detectFeatures(filePaths, config);
  const stack = detectStack(projectRoot);
  const name = projectName(projectRoot);
  const db = new Database(dbPath);
  initSchema(db);

  const existing = db
    .prepare(`SELECT id FROM projects WHERE root_path = ?`)
    .get(projectRoot) as { id: string } | undefined;

  if (existing) {
    clearProjectData(db, existing.id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(existing.id);
  }

  const projectId = crypto.randomUUID();

  db.prepare(
    `INSERT INTO projects (id, root_path, name, stack, spec_version, last_full_scan)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(projectId, projectRoot, name, JSON.stringify(stack), SPEC_VERSION, scannedAt);

  const insertFile = db.prepare(
    `INSERT INTO files (id, project_id, path, language, content_hash, is_test, is_entrypoint, feature_id, last_modified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSymbol = db.prepare(
    `INSERT INTO symbols (id, file_id, name, kind, signature, body_hash, exported, start_line, end_line)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFeature = db.prepare(
    `INSERT INTO features (id, project_id, slug, name, detection, entrypoint_file_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertRelation = db.prepare(
    `INSERT INTO relations (id, source_kind, source_id, target_kind, target_id, relation, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTest = db.prepare(
    `INSERT INTO tests (id, file_id, framework, covers_feature_id, covers_symbol_id)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertRef = db.prepare(
    `INSERT INTO context_refs (id, path, symbol, signature, content_hash, status, purpose, last_verified)
     VALUES (?, ?, ?, ?, ?, 'valid', ?, ?)`,
  );

  const featureIdBySlug = new Map<string, string>();
  const fileIdByPath = new Map<string, string>();
  const fileRecords: FileRecord[] = [];
  const symbolRecords: SymbolRecord[] = [];
  const symbolIdsByName = new Map<string, string[]>();

  for (const feature of features) {
    const featureId = crypto.randomUUID();
    featureIdBySlug.set(feature.slug, featureId);
    insertFeature.run(
      featureId,
      projectId,
      feature.slug,
      feature.name,
      feature.detection,
      null,
    );
  }

  const fileImports = new Map<string, string[]>();
  const entrypointBySlug = new Map(
    features.filter((f) => f.entrypoint).map((f) => [f.slug, f.entrypoint!]),
  );

  for (let fileIndex = 0; fileIndex < filePaths.length; fileIndex++) {
    const relPath = filePaths[fileIndex]!;
    emitScanProgress(
      {
        phase: "parse",
        current: fileIndex + 1,
        total: filePaths.length,
        label: relPath,
      },
      options.onProgress,
    );
    const absPath = join(projectRoot, relPath);
    const source = readFileSync(absPath, "utf8");
    const contentHash = sha256(source);
    const stat = statSync(absPath);
    const featureSlug = featureForPath(relPath, features);
    const featureId = featureSlug ? featureIdBySlug.get(featureSlug) ?? null : null;
    const isTest = isTestPath(relPath);
    const isEntry = relPath.endsWith("/index.ts") || relPath.endsWith("/index.tsx") ? 1 : 0;
    const fileId = crypto.randomUUID();

    fileIdByPath.set(relPath, fileId);
    fileRecords.push({ id: fileId, path: relPath, featureSlug, isTest });

    insertFile.run(
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

    if (featureSlug && entrypointBySlug.get(featureSlug) === relPath && featureId) {
      db.prepare(`UPDATE features SET entrypoint_file_id = ? WHERE id = ?`).run(
        fileId,
        featureId,
      );
    }

    const parsed = parseSource(relPath, source);

    const resolvedImports: string[] = [];
    for (const imp of parsed.imports) {
      const resolved = resolveImportPath(absPath, imp.specifier, projectRoot);
      if (resolved) resolvedImports.push(resolved);
    }
    fileImports.set(relPath, resolvedImports);

    let callRelationsForFile = 0;

    for (const sym of parsed.symbols) {
      const symbolId = crypto.randomUUID();
      const bodyHash = sha256(sym.bodyText);
      symbolRecords.push({
        id: symbolId,
        fileId,
        filePath: relPath,
        name: sym.name,
        kind: sym.kind,
        signature: sym.signature,
        bodyHash,
        exported: sym.exported,
      });
      const list = symbolIdsByName.get(sym.name) ?? [];
      list.push(symbolId);
      symbolIdsByName.set(sym.name, list);

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
      insertTest.run(
        crypto.randomUUID(),
        fileId,
        parsed.testFramework,
        featureId,
        null,
      );
    }

    for (const resolved of resolvedImports) {
      const targetFileId = fileIdByPath.get(resolved);
      if (!targetFileId) continue;
      insertRelation.run(
        crypto.randomUUID(),
        "file",
        fileId,
        "file",
        targetFileId,
        "imports",
        1,
      );
    }

    for (const call of parsed.calls) {
      if (callRelationsForFile >= SCAN_EXPORT_LIMITS.CALL_RELATIONS_MAX_PER_FILE) break;
      const targetIds = (symbolIdsByName.get(call.name) ?? []).slice(
        0,
        SCAN_EXPORT_LIMITS.CALL_TARGETS_MAX_PER_NAME,
      );
      for (const targetId of targetIds) {
        if (callRelationsForFile >= SCAN_EXPORT_LIMITS.CALL_RELATIONS_MAX_PER_FILE) break;
        insertRelation.run(
          crypto.randomUUID(),
          "file",
          fileId,
          "symbol",
          targetId,
          "calls",
          1,
        );
        callRelationsForFile++;
      }
    }
  }

  const featureDeps = new Map<string, Set<string>>();
  for (const file of fileRecords) {
    if (!file.featureSlug) continue;
    const deps = featureDeps.get(file.featureSlug) ?? new Set<string>();
    for (const imp of fileImports.get(file.path) ?? []) {
      const otherSlug = featureForPath(imp, features);
      if (otherSlug && otherSlug !== file.featureSlug) deps.add(otherSlug);
    }
    featureDeps.set(file.featureSlug, deps);
  }

  for (const feature of features) {
    const featureId = featureIdBySlug.get(feature.slug);
    if (!featureId) continue;
    const deps = [...(featureDeps.get(feature.slug) ?? [])].sort();
    feature.depends_on = deps;
    for (const otherSlug of deps) {
      const otherId = featureIdBySlug.get(otherSlug);
      if (!otherId) continue;
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

  const calledBy = new Map<string, Set<string>>();
  const profile = exportProfileForSymbolCount(symbolRecords.length);
  const fileIdToPath = new Map(fileRecords.map((f) => [f.id, f.path]));

  if (profile === "full") {
    const relations = db
      .prepare(`SELECT source_id, target_id, relation FROM relations WHERE relation = 'calls'`)
      .all() as Array<{ source_id: string; target_id: string; relation: string }>;

    for (const rel of relations) {
      const callerPath = fileIdToPath.get(rel.source_id);
      if (!callerPath) continue;
      const set = calledBy.get(rel.target_id) ?? new Set();
      if (set.size >= SCAN_EXPORT_LIMITS.CALLED_BY_MAX) continue;
      set.add(callerPath);
      calledBy.set(rel.target_id, set);
    }
  }

  symbolIdsByName.clear();

  function* iterExportSymbols(): Generator<ExportSymbol> {
    for (const s of symbolRecords) {
      yield {
        id: s.id,
        name: s.name,
        kind: s.kind,
        path: s.filePath,
        signature: s.signature,
        content_hash: s.bodyHash,
        exported: s.exported,
        called_by: [...(calledBy.get(s.id) ?? [])],
        imports_from: [],
      };
    }
  }

  let exportedSymbolCount = 0;
  for (const s of symbolRecords) {
    if (s.exported) exportedSymbolCount++;
  }

  const stats = {
    files: fileRecords.length,
    symbols: symbolRecords.length,
    features: features.length,
    tests: fileRecords.filter((f) => f.isTest).length,
  };

  emitScanProgress(
    { phase: "export", current: 0, total: 1, label: "Writing graph exports" },
    options.onProgress,
  );

  const exports = writeExports({
    projectRoot,
    projectName: name,
    scannedAt,
    stack,
    features,
    featureIdBySlug,
    files: fileRecords.map((f) => ({
      id: f.id,
      path: f.path,
      feature_slug: f.featureSlug,
      is_test: f.isTest,
    })),
    symbols: iterExportSymbols(),
    symbolCount: symbolRecords.length,
    exportedSymbolCount,
    symbolNameIndex: new Map(),
    relations: [],
    stats,
    git: getGitContext(projectRoot),
  });

  emitScanProgress(
    { phase: "export", current: 1, total: 1, label: "Finalizing graph" },
    options.onProgress,
  );

  db.close();

  return {
    projectRoot,
    agentCtxDir: agentDir,
    specVersion: SPEC_VERSION,
    status: "complete",
    message: `Scanned ${stats.files} files, ${stats.symbols} symbols, ${stats.features} features`,
    stats,
    exports,
  };
}