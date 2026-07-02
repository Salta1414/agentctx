import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initSchemaV2 } from "../db/schema-v2.js";
import { rebuildNirynRelations } from "./relations.js";

describe("rebuildNirynRelations", () => {
  it("deduplicates file-level call relations from multiple source symbols", () => {
    const db = new Database(":memory:");
    initSchemaV2(db);

    db.exec(`
      CREATE TABLE cbm_nodes (
        id INTEGER PRIMARY KEY,
        project TEXT NOT NULL,
        label TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        file_path TEXT DEFAULT '',
        start_line INTEGER DEFAULT 0,
        end_line INTEGER DEFAULT 0,
        properties TEXT DEFAULT '{}'
      );
      CREATE TABLE cbm_edges (
        id INTEGER PRIMARY KEY,
        project TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        properties TEXT DEFAULT '{}'
      );
    `);

    db.prepare(
      `INSERT INTO projects (id, root_path, name, stack, spec_version, last_full_scan, cbm_project_key)
       VALUES ('project', '/repo', 'repo', '[]', '2.0.0', 'now', 'cbm')`,
    ).run();
    db.prepare(
      `INSERT INTO files (id, project_id, path, language, content_hash, last_modified)
       VALUES ('file:src/a.ts', 'project', 'src/a.ts', 'typescript', 'hash', 'now'),
              ('file:src/b.ts', 'project', 'src/b.ts', 'typescript', 'hash', 'now')`,
    ).run();
    db.prepare(
      `INSERT INTO niryn_symbol_cache
       (project_id, id, file_path, name, kind, qualified_name)
       VALUES ('project', '1', 'src/a.ts', 'sourceOne', 'function', 'sourceOne'),
              ('project', '2', 'src/a.ts', 'sourceTwo', 'function', 'sourceTwo'),
              ('project', '3', 'src/b.ts', 'target', 'function', 'target')`,
    ).run();
    db.prepare(
      `INSERT INTO cbm_nodes (id, project, label, name, qualified_name, file_path)
       VALUES (1, 'cbm', 'Function', 'sourceOne', 'sourceOne', 'src/a.ts'),
              (2, 'cbm', 'Function', 'sourceTwo', 'sourceTwo', 'src/a.ts'),
              (3, 'cbm', 'Function', 'target', 'target', 'src/b.ts')`,
    ).run();
    db.prepare(
      `INSERT INTO cbm_edges (project, source_id, target_id, type)
       VALUES ('cbm', 1, 3, 'CALLS'),
              ('cbm', 2, 3, 'CALLS')`,
    ).run();

    const count = rebuildNirynRelations(db, "project", "cbm");
    expect(count).toBe(1);

    const rows = db
      .prepare(`SELECT id, relation FROM relations`)
      .all() as Array<{ id: string; relation: string }>;
    expect(rows).toEqual([
      { id: "file:src/a.ts:calls:3", relation: "calls" },
    ]);

    db.close();
  });
});
