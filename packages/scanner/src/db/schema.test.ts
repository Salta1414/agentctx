import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initSchema, migrateMultiProjectConstraints } from "./schema.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "niryn-schema-"));
  tempDirs.push(dir);
  return new Database(join(dir, "test.db"));
}

describe("features slug constraint", () => {
  it("allows the same slug for different projects", () => {
    const db = tempDb();
    initSchema(db);

    db.prepare(
      `INSERT INTO projects (id, root_path, name, stack, spec_version, last_full_scan)
       VALUES ('p1', '/a', 'A', '[]', '1.0.0', 'now'), ('p2', '/b', 'B', '[]', '1.0.0', 'now')`,
    ).run();

    db.prepare(
      `INSERT INTO features (id, project_id, slug, name, detection)
       VALUES ('f1', 'p1', 'daemon', 'Daemon', 'path-heuristic'),
              ('f2', 'p2', 'daemon', 'Daemon', 'path-heuristic')`,
    ).run();

    const count = db
      .prepare(`SELECT count(*) as c FROM features WHERE slug = 'daemon'`)
      .get() as { c: number };
    expect(count.c).toBe(2);
    db.close();
  });

  it("allows the same path for different projects", () => {
    const db = tempDb();
    initSchema(db);

    db.prepare(
      `INSERT INTO projects (id, root_path, name, stack, spec_version, last_full_scan)
       VALUES ('p1', '/a', 'A', '[]', '1.0.0', 'now'), ('p2', '/b', 'B', '[]', '1.0.0', 'now')`,
    ).run();

    db.prepare(
      `INSERT INTO files (id, project_id, path, language, content_hash, is_test, is_entrypoint, last_modified)
       VALUES ('file1', 'p1', 'packages/daemon/src/index.ts', 'typescript', 'h1', 0, 1, 'now'),
              ('file2', 'p2', 'packages/daemon/src/index.ts', 'typescript', 'h2', 0, 1, 'now')`,
    ).run();

    const count = db
      .prepare(`SELECT count(*) as c FROM files WHERE path = 'packages/daemon/src/index.ts'`)
      .get() as { c: number };
    expect(count.c).toBe(2);
    db.close();
  });

  it("migrates legacy global UNIQUE(slug) schema", () => {
    const db = tempDb();
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        name TEXT NOT NULL,
        stack TEXT NOT NULL DEFAULT '[]',
        spec_version TEXT NOT NULL,
        last_full_scan TEXT NOT NULL
      );
      CREATE TABLE features (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        detection TEXT NOT NULL,
        entrypoint_file_id TEXT
      );
    `);
    db.prepare(
      `INSERT INTO projects (id, root_path, name, stack, spec_version, last_full_scan)
       VALUES ('p1', '/a', 'A', '[]', '1.0.0', 'now'), ('p2', '/b', 'B', '[]', '1.0.0', 'now')`,
    ).run();
    db.prepare(
      `INSERT INTO features (id, project_id, slug, name, detection) VALUES ('f1', 'p1', 'cli', 'Cli', 'path')`,
    ).run();

    migrateMultiProjectConstraints(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO features (id, project_id, slug, name, detection) VALUES ('f2', 'p2', 'cli', 'Cli', 'path')`,
        )
        .run(),
    ).not.toThrow();
    db.close();
  });
});