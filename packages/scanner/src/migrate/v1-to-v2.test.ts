import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import { initSchema } from "../db/schema.js";
import { detectLegacyV1 } from "../indexer/overlay.js";
import {
  backupPathFor,
  downgradeV2ToV1,
  migrateV1ToV2,
  remapFeatureEntrypoints,
} from "./v1-to-v2.js";

function createLegacyFixture(root: string): { projectId: string; fileId: string } {
  mkdirSync(join(root, AGENTCTX_DIR), { recursive: true });
  const dbPath = join(root, AGENTCTX_DIR, "context.db");
  const db = new Database(dbPath);
  initSchema(db);

  const projectId = "proj-v1";
  const fileId = "file-v1";
  const symbolId = "sym-v1";
  const featureId = "feat-v1";
  const scannedAt = "2026-01-01T00:00:00.000Z";

  db.prepare(
    `INSERT INTO projects (id, root_path, name, stack, spec_version, last_full_scan)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(projectId, root, "legacy", "[]", "1.0.0", scannedAt);

  db.prepare(
    `INSERT INTO files (id, project_id, path, language, content_hash, is_test, is_entrypoint, feature_id, last_modified)
     VALUES (?, ?, ?, ?, ?, 0, 1, NULL, ?)`,
  ).run(fileId, projectId, "src/app.ts", "typescript", "abc", scannedAt);

  db.prepare(
    `INSERT INTO symbols (id, file_id, name, kind, signature, body_hash, exported, start_line, end_line)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, 10)`,
  ).run(symbolId, fileId, "main", "function", "main()", "def");

  db.prepare(
    `INSERT INTO features (id, project_id, slug, name, detection, entrypoint_file_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(featureId, projectId, "app", "App", "path", fileId);

  db.close();
  return { projectId, fileId };
}

describe("migrateV1ToV2", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("archives legacy tables and creates backup", () => {
    const root = join("/tmp", `niryn-migrate-${Date.now()}`);
    roots.push(root);
    createLegacyFixture(root);

    const db = new Database(join(root, AGENTCTX_DIR, "context.db"));
    expect(detectLegacyV1(db, root)).toBe(true);

    const result = migrateV1ToV2(db, root);
    expect(result.migrated).toBe(true);
    expect(existsSync(backupPathFor(root))).toBe(true);

    const legacySymbols = (
      db.prepare(`SELECT COUNT(*) AS c FROM _legacy_symbols`).get() as { c: number }
    ).c;
    expect(legacySymbols).toBe(1);
    expect(detectLegacyV1(db, root)).toBe(false);

    db.prepare(
      `INSERT INTO files (id, project_id, path, language, content_hash, is_test, is_entrypoint, feature_id, last_modified)
       VALUES ('file-v2', ?, 'src/app.ts', 'typescript', 'abc', 0, 1, NULL, datetime('now'))`,
    ).run("proj-v1");
    expect(remapFeatureEntrypoints(db, "proj-v1")).toBe(1);

    db.close();
  });

  it("restores backup on downgrade", () => {
    const root = join("/tmp", `niryn-downgrade-${Date.now()}`);
    roots.push(root);
    createLegacyFixture(root);

    const dbPath = join(root, AGENTCTX_DIR, "context.db");
    copyFileSync(dbPath, backupPathFor(root));

    const db = new Database(dbPath);
    migrateV1ToV2(db, root);
    db.close();

    expect(downgradeV2ToV1(root)).toBe(true);

    const restored = new Database(dbPath);
    const symbols = (
      restored.prepare(`SELECT COUNT(*) AS c FROM symbols`).get() as { c: number }
    ).c;
    expect(symbols).toBe(1);
    restored.close();
  });
});
