import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { AGENTCTX_DIR, SPEC_VERSION_V1 } from "@niryn/agentctx-spec";
import { initSchema } from "../db/schema.js";
import { initSchemaV2 } from "../db/schema-v2.js";
import { detectLegacyV1 } from "../indexer/overlay.js";
import { normalizeProjectRoot } from "../utils/paths.js";

const LEGACY_TABLES = ["symbols", "relations", "files", "tests"] as const;

export interface MigrationResult {
  migrated: boolean;
  backupPath: string | null;
  message: string;
}

function tableExists(db: DatabaseType, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

function renameLegacyTables(db: DatabaseType): void {
  db.pragma("foreign_keys = OFF");
  const tx = db.transaction(() => {
    for (const table of LEGACY_TABLES) {
      if (!tableExists(db, table)) {
        continue;
      }
      const legacyName = `_legacy_${table}`;
      if (tableExists(db, legacyName)) {
        db.exec(`DROP TABLE ${legacyName}`);
      }
      db.exec(`ALTER TABLE ${table} RENAME TO ${legacyName}`);
    }
  });
  tx();
  db.pragma("foreign_keys = ON");
}

export function backupPathFor(projectRoot: string): string {
  return join(normalizeProjectRoot(projectRoot), AGENTCTX_DIR, "context.db.v1.bak");
}

export function backupDatabase(dbPath: string, backupPath: string): void {
  copyFileSync(dbPath, backupPath);
}

/** Prepare a v1 graph DB for CBM re-index (backup + rename legacy tables). */
export function migrateV1ToV2(
  db: DatabaseType,
  projectRoot: string,
): MigrationResult {
  const root = normalizeProjectRoot(projectRoot);
  const dbPath = join(root, AGENTCTX_DIR, "context.db");
  const backup = backupPathFor(root);

  if (!detectLegacyV1(db, root)) {
    return { migrated: false, backupPath: null, message: "Already on AgentCtx v2 graph" };
  }

  if (!existsSync(backup)) {
    backupDatabase(dbPath, backup);
  }

  renameLegacyTables(db);
  initSchema(db);
  initSchemaV2(db);

  db.prepare(
    `UPDATE projects SET spec_version = ? WHERE root_path = ? AND spec_version = ?`,
  ).run(SPEC_VERSION_V1, root, SPEC_VERSION_V1);

  return {
    migrated: true,
    backupPath: backup,
    message: "Legacy v1 tables archived; run full scan to rebuild CBM graph",
  };
}

export function remapFeatureEntrypoints(db: DatabaseType, projectId: string): number {
  if (!tableExists(db, "_legacy_files")) {
    return 0;
  }

  const features = db
    .prepare(`SELECT id, entrypoint_file_id FROM features WHERE project_id = ?`)
    .all(projectId) as Array<{ id: string; entrypoint_file_id: string | null }>;

  let remapped = 0;
  for (const feature of features) {
    if (!feature.entrypoint_file_id) {
      continue;
    }
    const legacy = db
      .prepare(`SELECT path FROM _legacy_files WHERE id = ?`)
      .get(feature.entrypoint_file_id) as { path: string } | undefined;
    if (!legacy?.path) {
      continue;
    }
    const next = db
      .prepare(`SELECT id FROM files WHERE project_id = ? AND path = ?`)
      .get(projectId, legacy.path) as { id: string } | undefined;
    if (!next) {
      continue;
    }
    db.prepare(`UPDATE features SET entrypoint_file_id = ? WHERE id = ?`).run(
      next.id,
      feature.id,
    );
    remapped += 1;
  }
  return remapped;
}

export function dropLegacyTables(db: DatabaseType): void {
  db.pragma("foreign_keys = OFF");
  for (const table of LEGACY_TABLES) {
    const legacyName = `_legacy_${table}`;
    if (tableExists(db, legacyName)) {
      db.exec(`DROP TABLE ${legacyName}`);
    }
  }
  db.pragma("foreign_keys = ON");
}

export function downgradeV2ToV1(projectRoot: string): boolean {
  const root = normalizeProjectRoot(projectRoot);
  const dbPath = join(root, AGENTCTX_DIR, "context.db");
  const backup = backupPathFor(root);
  if (!existsSync(backup)) {
    return false;
  }
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
  copyFileSync(backup, dbPath);
  return true;
}

export function runMigrateProject(projectRoot: string): MigrationResult {
  const root = normalizeProjectRoot(projectRoot);
  const dbPath = join(root, AGENTCTX_DIR, "context.db");
  const db = new Database(dbPath);
  try {
    return migrateV1ToV2(db, root);
  } finally {
    db.close();
  }
}
