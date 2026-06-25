import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { runScan } from "./scan.js";

const fixtureRoot = resolve(
  fileURLToPath(new URL("../test-fixtures/demo", import.meta.url)),
);

beforeAll(async () => {
  await runScan({ projectRoot: fixtureRoot, full: true });
});

describe("depends_on detection", () => {
  it("detects invoices depends on projects via relative imports", () => {
    const db = new Database(
      resolve(fixtureRoot, ".agentctx/context.db"),
      { readonly: true },
    );

    const features = db
      .prepare(`SELECT id, slug FROM features`)
      .all() as Array<{ id: string; slug: string }>;
    const invoices = features.find((f) => f.slug === "invoices");
    const projects = features.find((f) => f.slug === "projects");
    expect(invoices).toBeDefined();
    expect(projects).toBeDefined();

    const rel = db
      .prepare(
        `SELECT id FROM relations
         WHERE relation = 'depends_on' AND source_id = ? AND target_id = ?`,
      )
      .get(invoices!.id, projects!.id);
    expect(rel).toBeDefined();
    db.close();
  });
});