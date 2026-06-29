import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runIncrementalScan } from "./incremental.js";
import { runScan } from "./scan.js";
import { verifyContextRefs } from "./verify-refs.js";

const fixtureRoot = resolve(
  fileURLToPath(new URL("../test-fixtures/demo", import.meta.url)),
);
const targetFile = join(fixtureRoot, "src/features/invoices/createInvoice.ts");
const ignoredFile = join(fixtureRoot, "node_modules/demo-package/index.ts");
let originalSource = "";

beforeAll(async () => {
  await runScan({ projectRoot: fixtureRoot, full: true });
  originalSource = readFileSync(targetFile, "utf8");
}, 120_000);

afterEach(async () => {
  rmSync(join(fixtureRoot, "node_modules/demo-package"), {
    recursive: true,
    force: true,
  });
  writeFileSync(targetFile, originalSource, "utf8");
  await runIncrementalScan({
    projectRoot: fixtureRoot,
    changedPaths: ["src/features/invoices/createInvoice.ts"],
  });
});

describe("runIncrementalScan", () => {
  it("updates graph when a file changes", async () => {
    const modified = originalSource.replace(
      "Cannot create invoice before client approval",
      "Cannot create invoice before project approval",
    );
    writeFileSync(targetFile, modified, "utf8");

    const result = await runIncrementalScan({
      projectRoot: fixtureRoot,
      changedPaths: ["src/features/invoices/createInvoice.ts"],
    });

    expect(result.changed).toContain("src/features/invoices/createInvoice.ts");
    expect(result.stats.files).toBeGreaterThan(0);

    const onDisk = readFileSync(
      join(fixtureRoot, ".agentctx", "manifest.json"),
      "utf8",
    );
    expect(onDisk).toContain("last_incremental_scan");
  });

  it("detects stale refs when file content hash changes", () => {
    const modified = `${originalSource}\n// hash-bump\n`;
    writeFileSync(targetFile, modified, "utf8");

    const stale = verifyContextRefs(fixtureRoot);
    expect(stale.stale_count).toBeGreaterThan(0);
    expect(stale.refs.some((r) => r.status === "changed")).toBe(true);
  });

  it("restores valid refs after incremental update", async () => {
    const modified = `${originalSource}\n// hash-bump\n`;
    writeFileSync(targetFile, modified, "utf8");

    await runIncrementalScan({
      projectRoot: fixtureRoot,
      changedPaths: ["src/features/invoices/createInvoice.ts"],
    });

    const fresh = verifyContextRefs(fixtureRoot);
    expect(fresh.stale_count).toBe(0);
  });

  it("does not index ignored paths during incremental updates", async () => {
    mkdirSync(join(fixtureRoot, "node_modules/demo-package"), { recursive: true });
    writeFileSync(ignoredFile, "export function ignoredPackageSymbol() {}\n", "utf8");

    const result = await runIncrementalScan({
      projectRoot: fixtureRoot,
      changedPaths: ["node_modules/demo-package/index.ts"],
    });

    expect(result.changed).not.toContain("node_modules/demo-package/index.ts");
    const symbolsJson = readFileSync(
      join(fixtureRoot, ".agentctx", "maps", "symbols.json"),
      "utf8",
    );
    expect(symbolsJson).not.toContain("ignoredPackageSymbol");
    expect(symbolsJson).not.toContain("node_modules/demo-package");
  });
});
