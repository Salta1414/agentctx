import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENTCTX_DIR, SPEC_VERSION } from "@niryn/agentctx-spec";
import type { Manifest } from "@niryn/agentctx-spec";
import {
  exportProfileForSymbolCount,
  SCAN_EXPORT_LIMITS,
  type ExportProfile,
} from "../constants/export-limits.js";
import type { DetectedFeature } from "../features/detect.js";
import type { GitContext } from "../git/context.js";
import { buildDecisionsSection } from "./decisions.js";
import { buildNowMd } from "./now.js";
import { writeJsonArrayFile, writeJsonFile } from "./stream-json.js";

export interface ExportSymbol {
  id: string;
  name: string;
  kind: string;
  path: string;
  signature: string;
  content_hash: string;
  exported: boolean;
  called_by: string[];
  imports_from: string[];
}

export interface ExportContext {
  projectRoot: string;
  projectName: string;
  scannedAt: string;
  lastIncrementalScan?: string;
  stack: string[];
  features: DetectedFeature[];
  featureIdBySlug: Map<string, string>;
  files: Array<{ id: string; path: string; feature_slug: string | null; is_test: boolean }>;
  symbols: ExportSymbol[] | Iterable<ExportSymbol>;
  symbolCount: number;
  exportedSymbolCount: number;
  symbolNameIndex: Map<string, ExportSymbol[]>;
  relations: Array<{ source_name: string; target_name: string; relation: string }>;
  stats: Manifest["stats"];
  git?: GitContext;
  activeFile?: string | null;
}

function buildFeatureFileIndex(
  files: ExportContext["files"],
): {
  bySlug: Map<string, string[]>;
  testsBySlug: Map<string, string[]>;
} {
  const bySlug = new Map<string, string[]>();
  const testsBySlug = new Map<string, string[]>();
  for (const file of files) {
    if (!file.feature_slug) continue;
    const list = bySlug.get(file.feature_slug) ?? [];
    list.push(file.path);
    bySlug.set(file.feature_slug, list);
    if (file.is_test) {
      const tests = testsBySlug.get(file.feature_slug) ?? [];
      tests.push(file.path);
      testsBySlug.set(file.feature_slug, tests);
    }
  }
  return { bySlug, testsBySlug };
}

function* compactSymbols(
  symbols: Iterable<ExportSymbol>,
  profile: ExportProfile,
): Generator<ReturnType<typeof compactSymbol>> {
  for (const symbol of symbols) {
    yield compactSymbol(symbol, profile);
  }
}

function writeText(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function truncateSignature(sig: string, profile: ExportProfile): string {
  if (profile === "full") return sig;
  const max = SCAN_EXPORT_LIMITS.SIGNATURE_MAX_LEN;
  return sig.length <= max ? sig : `${sig.slice(0, max)}…`;
}

function compactSymbol(s: ExportSymbol, profile: ExportProfile) {
  const base = {
    name: s.name,
    kind: s.kind,
    path: s.path,
    signature: truncateSignature(s.signature, profile),
    exported: s.exported,
  };
  if (profile === "summary") return base;
  return {
    ...base,
    content_hash: s.content_hash,
    called_by: s.called_by.slice(0, SCAN_EXPORT_LIMITS.CALLED_BY_MAX),
    imports_from: s.imports_from.slice(0, SCAN_EXPORT_LIMITS.CALLED_BY_MAX),
  };
}

function* iterateExported(symbols: ExportContext["symbols"]): Generator<ExportSymbol> {
  for (const symbol of symbols) {
    if (symbol.exported) yield symbol;
  }
}

function exportedPreview(symbols: ExportContext["symbols"], limit: number): ExportSymbol[] {
  const out: ExportSymbol[] = [];
  for (const symbol of symbols) {
    if (!symbol.exported) continue;
    out.push(symbol);
    if (out.length >= limit) break;
  }
  return out;
}

export function writeExports(ctx: ExportContext): string[] {
  const agentDir = join(ctx.projectRoot, AGENTCTX_DIR);
  const written: string[] = [];
  const profile = exportProfileForSymbolCount(ctx.symbolCount);

  let billingSlotId: string | undefined;
  try {
    const existing = JSON.parse(
      readFileSync(join(agentDir, "manifest.json"), "utf8"),
    ) as Manifest;
    billingSlotId = existing.billing_slot_id;
  } catch {
    /* first scan */
  }

  const manifest: Manifest = {
    spec_version: SPEC_VERSION,
    project: { name: ctx.projectName, root: ctx.projectRoot },
    generator: { name: "niryn", version: "0.1.0" },
    last_full_scan: ctx.scannedAt,
    ...(ctx.lastIncrementalScan
      ? { last_incremental_scan: ctx.lastIncrementalScan }
      : {}),
    stack: ctx.stack,
    stats: ctx.stats,
    export_profile: profile,
    ...(billingSlotId ? { billing_slot_id: billingSlotId } : {}),
  };

  if (profile === "summary") {
    manifest.export_note =
      "Large project: JSON maps are summarized. Full graph is in context.db — use the API or MCP tools.";
  }

  writeJsonFile(join(agentDir, "manifest.json"), manifest);
  written.push(`${AGENTCTX_DIR}/manifest.json`);

  const { bySlug: filesByFeature, testsBySlug } = buildFeatureFileIndex(ctx.files);
  const cap = SCAN_EXPORT_LIMITS.FEATURE_FILES_MAX;

  const featuresPayload = ctx.features.map((f) => {
    const allFiles = filesByFeature.get(f.slug) ?? [];
    const files = allFiles.length <= cap ? allFiles : allFiles.slice(0, cap);
    const tests = (testsBySlug.get(f.slug) ?? []).slice(0, cap);

    const entry: Record<string, unknown> = {
      slug: f.slug,
      name: f.name,
      detection: f.detection,
      entrypoint: f.entrypoint ?? null,
      files,
      depends_on: f.depends_on ?? [],
      tests,
    };
    if (allFiles.length > cap) {
      entry.files_total = allFiles.length;
      entry.files_truncated = true;
    }
    return entry;
  });

  if (featuresPayload.length >= SCAN_EXPORT_LIMITS.STREAM_ARRAY_MIN) {
    writeJsonArrayFile(join(agentDir, "maps", "features.json"), "features", featuresPayload);
  } else {
    writeJsonFile(join(agentDir, "maps", "features.json"), { features: featuresPayload });
  }
  written.push(`${AGENTCTX_DIR}/maps/features.json`);

  const symbolStream = compactSymbols(
    Array.isArray(ctx.symbols) ? ctx.symbols : ctx.symbols,
    profile,
  );
  if (ctx.symbolCount >= SCAN_EXPORT_LIMITS.STREAM_ARRAY_MIN) {
    writeJsonArrayFile(join(agentDir, "maps", "symbols.json"), "symbols", symbolStream);
  } else {
    writeJsonFile(join(agentDir, "maps", "symbols.json"), {
      symbols: [...symbolStream],
    });
  }
  written.push(`${AGENTCTX_DIR}/maps/symbols.json`);

  const exportedTotal = ctx.exportedSymbolCount;
  const registryCap = SCAN_EXPORT_LIMITS.REGISTRY_MAX;

  function* registryRefs(): Generator<Record<string, unknown>> {
    let written = 0;
    for (const s of iterateExported(ctx.symbols)) {
      if (written >= registryCap) break;
      yield {
        ref_id: s.id,
        path: s.path,
        symbol: s.name,
        kind: s.kind,
        signature: truncateSignature(s.signature, profile),
        ...(profile === "full" ? { content_hash: s.content_hash } : {}),
        status: "valid",
        purpose: `${s.kind} in ${s.path}`,
      };
      written++;
    }
  }

  const refsTruncated = exportedTotal > registryCap;
  const refsWritten = Math.min(exportedTotal, registryCap);

  if (refsWritten >= SCAN_EXPORT_LIMITS.STREAM_ARRAY_MIN) {
    writeJsonArrayFile(join(agentDir, "refs", "registry.json"), "refs", registryRefs());
    if (refsTruncated) {
      writeJsonFile(join(agentDir, "refs", "registry.meta.json"), {
        refs_total: exportedTotal,
        refs_truncated: true,
      });
      written.push(`${AGENTCTX_DIR}/refs/registry.meta.json`);
    }
  } else {
    const refs = [...registryRefs()];
    const registry: Record<string, unknown> = { refs };
    if (refsTruncated) {
      registry.refs_total = exportedTotal;
      registry.refs_truncated = true;
    }
    writeJsonFile(join(agentDir, "refs", "registry.json"), registry);
  }
  written.push(`${AGENTCTX_DIR}/refs/registry.json`);

  const indexMd = buildIndexMd(ctx, profile);
  writeText(join(agentDir, "index.md"), indexMd);
  written.push(`${AGENTCTX_DIR}/index.md`);

  const currentMd = buildCurrentContextMd(ctx, profile);
  writeText(join(agentDir, "current-context.md"), currentMd);
  written.push(`${AGENTCTX_DIR}/current-context.md`);

  const agentsMd = buildAgentsMd(profile);
  writeText(join(ctx.projectRoot, "AGENTS.md"), agentsMd);
  written.push("AGENTS.md");

  const claudeMd = buildClaudeMd(profile);
  writeText(join(ctx.projectRoot, "CLAUDE.md"), claudeMd);
  written.push("CLAUDE.md");

  const cursorRule = buildCursorRule(profile);
  writeText(join(ctx.projectRoot, ".cursor", "rules", "project.mdc"), cursorRule);
  written.push(".cursor/rules/project.mdc");

  if (ctx.git) {
    const nowMd = buildNowMd({
      projectName: ctx.projectName,
      scannedAt: ctx.scannedAt,
      features: ctx.features,
      files: ctx.files,
      symbols: ctx.symbols,
      now: { git: ctx.git, activeFile: ctx.activeFile },
    });
    writeText(join(agentDir, "now.md"), nowMd);
    written.push(`${AGENTCTX_DIR}/now.md`);
  }

  return written;
}

function buildIndexMd(ctx: ExportContext, profile: ExportProfile): string {
  const lines = [
    `# Project Map: ${ctx.projectName}`,
    "",
    `Scanned: ${ctx.scannedAt}`,
    `Export profile: **${profile}** (canonical graph: \`.agentctx/context.db\`)`,
    "",
    `## Stats`,
    "",
    `- Files: ${ctx.stats.files}`,
    `- Symbols: ${ctx.stats.symbols}`,
    `- Features: ${ctx.stats.features}`,
    `- Tests: ${ctx.stats.tests}`,
    "",
    `## Features`,
    "",
  ];

  const featurePreview = ctx.features.slice(0, 50);
  const { bySlug: indexFiles } = buildFeatureFileIndex(ctx.files);
  for (const f of featurePreview) {
    const fileCount = (indexFiles.get(f.slug) ?? []).length;
    lines.push(`### ${f.name} (\`${f.slug}\`)`);
    lines.push("");
    if (f.entrypoint) lines.push(`- Entry: \`${f.entrypoint}\``);
    lines.push(`- Files: ${fileCount}`);
    lines.push("");
  }
  if (ctx.features.length > featurePreview.length) {
    lines.push(`_…and ${ctx.features.length - featurePreview.length} more features_`, "");
  }

  lines.push(`## Top Exported Symbols`, "");
  for (const s of exportedPreview(ctx.symbols, 20)) {
    lines.push(`- \`${truncateSignature(s.signature, profile)}\` — \`${s.path}\``);
  }
  lines.push("");
  return lines.join("\n");
}

function buildCurrentContextMd(ctx: ExportContext, profile: ExportProfile): string {
  const featureLines = ctx.features.slice(0, 80).map((f) => `- ${f.name} (\`${f.slug}\`)`);
  if (ctx.features.length > 80) {
    featureLines.push(`- …${ctx.features.length - 80} more`);
  }

  const decisionsSection = buildDecisionsSection(ctx.projectRoot);

  const lines = [
    `# Current Context`,
    "",
    `Project: **${ctx.projectName}**`,
    `Last scan: ${ctx.scannedAt}`,
    `Export profile: ${profile}`,
    "",
    `Use \`POST /v1/context/pack\` or MCP \`get_context_pack\` for task-specific context.`,
    profile === "summary"
      ? `Large repo: prefer API/MCP over reading full \`symbols.json\`.`
      : `Read \`.agentctx/maps/\` for browsable exports.`,
    "",
  ];

  if (decisionsSection) {
    lines.push(decisionsSection.trimEnd(), "");
  }

  lines.push(`## Features`, ...featureLines, "");
  return lines.join("\n");
}

function buildAgentsMd(profile: ExportProfile): string {
  return buildAgentRouterMd("Agent Instructions", profile);
}

function buildClaudeMd(profile: ExportProfile): string {
  return buildAgentRouterMd("Claude Code Instructions", profile);
}

function buildAgentRouterMd(title: string, profile: ExportProfile): string {
  return [
    `# ${title}`,
    "",
    `This project uses the AgentCtx standard (via Niryn).`,
    "",
    `Before editing code:`,
    `1. Read \`.agentctx/current-context.md\` (includes active decisions)`,
    `2. Use \`POST localhost:47321/v1/context/pack\` or MCP \`get_context_pack\``,
    `3. Prefer the local graph API over broad repo search`,
    profile === "summary"
      ? `4. \`symbols.json\` may be summarized — use the API for full symbol lookup`
      : `4. Check \`.agentctx/maps/symbols.json\` for symbol locations`,
    `5. Check ref status — if \`changed\` or \`outdated\`, re-read source before editing`,
    `6. Capture chat decisions with MCP \`record_decision\` (e.g. provider or stack changes)`,
    "",
    `Fallback: read \`.agentctx/packs/latest.json\` if the local server is unavailable.`,
    "",
  ].join("\n");
}

function buildCursorRule(profile: ExportProfile): string {
  return [
    "---",
    "description: Niryn project context — read before editing code",
    "globs:",
    "  - \"**/*\"",
    "alwaysApply: true",
    "---",
    "",
    "This project uses Niryn (AgentCtx). Before editing:",
    "",
    "1. Read `.agentctx/current-context.md` (active decisions)",
    "2. Use MCP `get_context_pack` or the local API for task-specific context",
    profile === "summary"
      ? "3. Prefer API/MCP over full `symbols.json` on large repos"
      : "3. Use `.agentctx/maps/symbols.json` for symbol lookup",
    "4. Re-read source when refs are `changed` or `outdated`",
    "5. Use MCP `record_decision` to persist project intent from chat",
    "",
  ].join("\n");
}