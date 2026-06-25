import type Database from "better-sqlite3";

function tableSql(db: Database.Database, table: string): string | null {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql?: string } | undefined;
  return row?.sql ?? null;
}

function hasCompositeUnique(sql: string, columns: string[]): boolean {
  const cols = columns.join("\\s*,\\s*");
  return new RegExp(`unique\\s*\\(\\s*${cols}\\s*\\)`, "i").test(sql);
}

/** Older DBs used global UNIQUE constraints — breaks multi-project context.db files. */
export function migrateMultiProjectConstraints(db: Database.Database): void {
  const featuresSql = tableSql(db, "features");
  const filesSql = tableSql(db, "files");
  const needsFeatures =
    featuresSql !== null && !hasCompositeUnique(featuresSql, ["project_id", "slug"]);
  const needsFiles =
    filesSql !== null && !hasCompositeUnique(filesSql, ["project_id", "path"]);
  if (!needsFeatures && !needsFiles) return;

  db.pragma("foreign_keys = OFF");
  const migrate = db.transaction(() => {
    if (needsFeatures) {
      db.exec(`DROP TABLE IF EXISTS features__migrate`);
      db.exec(`
        CREATE TABLE features__migrate (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          detection TEXT NOT NULL,
          entrypoint_file_id TEXT,
          UNIQUE(project_id, slug)
        );
        INSERT INTO features__migrate
          SELECT id, project_id, slug, name, detection, entrypoint_file_id FROM features;
        DROP TABLE features;
        ALTER TABLE features__migrate RENAME TO features;
      `);
    }

    if (needsFiles) {
      db.exec(`DROP TABLE IF EXISTS files__migrate`);
      db.exec(`
        CREATE TABLE files__migrate (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          path TEXT NOT NULL,
          language TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          is_test INTEGER NOT NULL DEFAULT 0,
          is_entrypoint INTEGER NOT NULL DEFAULT 0,
          feature_id TEXT,
          last_modified TEXT NOT NULL,
          UNIQUE(project_id, path)
        );
        INSERT INTO files__migrate
          SELECT id, project_id, path, language, content_hash, is_test, is_entrypoint, feature_id, last_modified
          FROM files;
        DROP TABLE files;
        ALTER TABLE files__migrate RENAME TO files;
        CREATE INDEX IF NOT EXISTS idx_files_feature ON files(feature_id);
      `);
    }
  });

  try {
    migrate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      name TEXT NOT NULL,
      stack TEXT NOT NULL DEFAULT '[]',
      spec_version TEXT NOT NULL,
      last_full_scan TEXT NOT NULL,
      last_incremental_scan TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      path TEXT NOT NULL,
      language TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      is_test INTEGER NOT NULL DEFAULT 0,
      is_entrypoint INTEGER NOT NULL DEFAULT 0,
      feature_id TEXT,
      last_modified TEXT NOT NULL,
      UNIQUE(project_id, path)
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES files(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      signature TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      exported INTEGER NOT NULL DEFAULT 0,
      start_line INTEGER,
      end_line INTEGER
    );

    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      detection TEXT NOT NULL,
      entrypoint_file_id TEXT,
      UNIQUE(project_id, slug)
    );

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES files(id),
      framework TEXT,
      covers_feature_id TEXT,
      covers_symbol_id TEXT
    );

    CREATE TABLE IF NOT EXISTS context_refs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      symbol TEXT,
      signature TEXT,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'valid',
      purpose TEXT,
      last_verified TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_files_feature ON files(feature_id);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
  `);

  migrateMultiProjectConstraints(db);
}

export function clearProjectData(db: Database.Database, projectId: string): void {
  const tables = [
    "relations",
    "tests",
    "symbols",
    "files",
    "features",
    "context_refs",
  ];
  for (const table of tables) {
    if (table === "files" || table === "features") {
      db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    } else if (table === "context_refs") {
      db.prepare(`DELETE FROM ${table}`).run();
    } else {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  }
}