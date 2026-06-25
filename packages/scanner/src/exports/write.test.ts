import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCAN_EXPORT_LIMITS } from "../constants/export-limits.js";
import { writeExports, type ExportSymbol } from "./write.js";

function makeSymbol(i: number): ExportSymbol {
  return {
    id: `sym-${i}`,
    name: `fn${i}`,
    kind: "function",
    path: `src/a/file${i % 10}.ts`,
    signature: `export function fn${i}(): void`,
    content_hash: `hash-${i}`,
    exported: i % 3 === 0,
    called_by: i < 5 ? [`src/caller${i}.ts`] : [],
    imports_from: [],
  };
}

describe("writeExports large repos", () => {
  let root = "";

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("streams symbols.json without summary profile below threshold", () => {
    root = mkdtempSync(join(tmpdir(), "niryn-export-"));
    const symbols = Array.from({ length: 400 }, (_, i) => makeSymbol(i));

    writeExports({
      projectRoot: root,
      projectName: "small",
      scannedAt: new Date().toISOString(),
      stack: ["typescript"],
      features: [{ slug: "core", name: "Core", detection: "path-heuristic", paths: ["src"] }],
      featureIdBySlug: new Map([["core", "feat-1"]]),
      files: symbols.map((s, i) => ({
        id: `file-${i}`,
        path: s.path,
        feature_slug: "core",
        is_test: false,
      })),
      symbols,
      symbolCount: symbols.length,
      exportedSymbolCount: symbols.filter((s) => s.exported).length,
      symbolNameIndex: new Map(),
      relations: [],
      stats: { files: symbols.length, symbols: symbols.length, features: 1, tests: 0 },
    });

    const manifest = JSON.parse(
      readFileSync(join(root, ".agentctx", "manifest.json"), "utf8"),
    ) as { export_profile?: string };
    expect(manifest.export_profile).toBe("full");

    const symbolsJson = readFileSync(join(root, ".agentctx", "maps", "symbols.json"), "utf8");
    const parsed = JSON.parse(symbolsJson) as { symbols: unknown[] };
    expect(parsed.symbols).toHaveLength(400);
    expect(symbolsJson.length).toBeGreaterThan(1000);
  });

  it("uses summary profile and streams huge symbol lists", () => {
    root = mkdtempSync(join(tmpdir(), "niryn-export-"));
    const count = SCAN_EXPORT_LIMITS.FULL_SYMBOL_DETAIL_MAX + 500;
    const symbols = Array.from({ length: count }, (_, i) => makeSymbol(i));

    const written = writeExports({
      projectRoot: root,
      projectName: "huge",
      scannedAt: new Date().toISOString(),
      stack: ["typescript"],
      features: [{ slug: "core", name: "Core", detection: "path-heuristic", paths: ["src"] }],
      featureIdBySlug: new Map([["core", "feat-1"]]),
      files: [],
      symbols,
      symbolCount: symbols.length,
      exportedSymbolCount: symbols.filter((s) => s.exported).length,
      symbolNameIndex: new Map(),
      relations: [],
      stats: { files: 0, symbols: count, features: 1, tests: 0 },
    });

    expect(written).toContain(".agentctx/maps/symbols.json");

    const manifest = JSON.parse(
      readFileSync(join(root, ".agentctx", "manifest.json"), "utf8"),
    ) as { export_profile?: string; export_note?: string };
    expect(manifest.export_profile).toBe("summary");
    expect(manifest.export_note).toContain("Large project");

    const symbolsJson = readFileSync(join(root, ".agentctx", "maps", "symbols.json"), "utf8");
    const parsed = JSON.parse(symbolsJson) as {
      symbols: Array<{ called_by?: string[]; content_hash?: string }>;
    };
    expect(parsed.symbols).toHaveLength(count);
    expect(parsed.symbols[0]?.called_by).toBeUndefined();
    expect(parsed.symbols[0]?.content_hash).toBeUndefined();
  });
});
