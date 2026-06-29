import type Database from "better-sqlite3";
import { initSchema } from "./schema.js";

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/** Niryn v2 overlay: Niryn tables + bridge columns. CBM owns cbm_* tables via init_schema. */
export function initSchemaV2(db: Database.Database): void {
  initSchema(db);

  if (!columnExists(db, "projects", "cbm_project_key")) {
    db.exec(`ALTER TABLE projects ADD COLUMN cbm_project_key TEXT`);
  }
  if (!columnExists(db, "projects", "indexer_version")) {
    db.exec(`ALTER TABLE projects ADD COLUMN indexer_version TEXT`);
  }

  if (!tableExists(db, "niryn_index_meta")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS niryn_index_meta (
        project_id TEXT PRIMARY KEY REFERENCES projects(id),
        last_index_at TEXT NOT NULL,
        node_count INTEGER NOT NULL DEFAULT 0,
        edge_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  if (!tableExists(db, "niryn_symbol_cache")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS niryn_symbol_cache (
        project_id TEXT NOT NULL REFERENCES projects(id),
        id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        signature TEXT,
        exported INTEGER NOT NULL DEFAULT 1,
        start_line INTEGER,
        end_line INTEGER,
        PRIMARY KEY (project_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_niryn_symbol_cache_project ON niryn_symbol_cache(project_id);
      CREATE INDEX IF NOT EXISTS idx_niryn_symbol_cache_name ON niryn_symbol_cache(name);
    `);
  }

  if (!tableExists(db, "niryn_relation_cache")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS niryn_relation_cache (
        project_id TEXT NOT NULL REFERENCES projects(id),
        id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        PRIMARY KEY (project_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_niryn_relation_cache_project ON niryn_relation_cache(project_id);
    `);
  }
}
