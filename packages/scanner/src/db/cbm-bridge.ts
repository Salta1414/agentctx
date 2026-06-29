import type Database from "better-sqlite3";

const SAFE_PROJECT_CHARS = /[^A-Za-z0-9._-]/g;

/** Port of cbm_project_name_from_path (packages/indexer/src/pipeline/fqn.c). */
export function cbmProjectKeyFromRoot(projectRoot: string): string {
  if (!projectRoot) {
    return "root";
  }

  let path = projectRoot.replace(/\\/g, "/");
  path = path.replace(SAFE_PROJECT_CHARS, "-");
  path = path.replace(/-+/g, "-").replace(/\.+/g, ".");
  path = path.replace(/^[-.]+/, "").replace(/-+$/, "");

  return path.length > 0 ? path : "root";
}

export function ensureProjectRow(
  db: Database.Database,
  opts: {
    id: string;
    rootPath: string;
    name: string;
    specVersion: string;
    indexerVersion?: string;
  },
): void {
  const cbmKey = cbmProjectKeyFromRoot(opts.rootPath);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, root_path, name, stack, spec_version, last_full_scan, last_incremental_scan, cbm_project_key, indexer_version)
     VALUES (@id, @rootPath, @name, '[]', @specVersion, @now, @now, @cbmKey, @indexerVersion)
     ON CONFLICT(id) DO UPDATE SET
       root_path = excluded.root_path,
       name = excluded.name,
       cbm_project_key = excluded.cbm_project_key,
       indexer_version = COALESCE(excluded.indexer_version, projects.indexer_version)`,
  ).run({
    id: opts.id,
    rootPath: opts.rootPath,
    name: opts.name,
    specVersion: opts.specVersion,
    now,
    cbmKey,
    indexerVersion: opts.indexerVersion ?? null,
  });
}
