import type { DetectedFeature } from "../features/detect.js";
import type { GitContext } from "../git/context.js";
import type { ExportSymbol } from "./write.js";

export interface NowContext {
  git: GitContext;
  activeFile?: string | null;
}

function featureSlugsForPaths(
  paths: string[],
  files: Array<{ path: string; feature_slug: string | null }>,
): string[] {
  const pathSet = new Set(paths);
  const slugs = new Set<string>();
  for (const file of files) {
    if (file.feature_slug && pathSet.has(file.path)) {
      slugs.add(file.feature_slug);
    }
  }
  return [...slugs];
}

function symbolsForPaths(paths: string[], symbols: Iterable<ExportSymbol>, limit = 12): ExportSymbol[] {
  const pathSet = new Set(paths);
  const out: ExportSymbol[] = [];
  for (const sym of symbols) {
    if (!pathSet.has(sym.path)) continue;
    out.push(sym);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildNowMd(input: {
  projectName: string;
  scannedAt: string;
  features: DetectedFeature[];
  files: Array<{ path: string; feature_slug: string | null }>;
  symbols: ExportSymbol[] | Iterable<ExportSymbol>;
  now: NowContext;
}): string {
  const focusPaths = [
    ...(input.now.activeFile ? [input.now.activeFile] : []),
    ...input.now.git.changedFiles,
    ...input.now.git.recentCommitFiles,
  ].filter(Boolean);
  const uniqueFocus = [...new Set(focusPaths)].slice(0, 24);

  const featureSlugs = featureSlugsForPaths(uniqueFocus, input.files);
  const featureNames = input.features
    .filter((f) => featureSlugs.includes(f.slug))
    .map((f) => f.name);

  const focusSymbols = symbolsForPaths(uniqueFocus, input.symbols);

  const lines = [
    "# Live Context (now)",
    "",
    `Project: **${input.projectName}**`,
    `Updated: ${input.scannedAt}`,
    "",
  ];

  if (input.now.git.branch) {
    lines.push(`**Branch:** \`${input.now.git.branch}\``, "");
  }

  if (featureNames.length > 0) {
    lines.push("## Likely focus areas", "");
    for (const name of featureNames) lines.push(`- ${name}`);
    lines.push("");
  } else if (uniqueFocus.length > 0) {
    lines.push("## Changed / recent files", "");
    for (const p of uniqueFocus.slice(0, 12)) lines.push(`- \`${p}\``);
    lines.push("");
  }

  if (focusSymbols.length > 0) {
    lines.push("## Symbols in focus", "");
    for (const s of focusSymbols) {
      lines.push(`- \`${s.name}\` (${s.kind}) — \`${s.path}\``);
    }
    lines.push("");
  }

  if (input.now.git.changedFiles.length > 0) {
    lines.push("## Uncommitted changes", "");
    for (const p of input.now.git.changedFiles.slice(0, 15)) {
      lines.push(`- \`${p}\``);
    }
    if (input.now.git.changedFiles.length > 15) {
      lines.push(`- …${input.now.git.changedFiles.length - 15} more`);
    }
    lines.push("");
  }

  lines.push(
    "_Regenerated on scan/watch. Point your editor at a file and rescan to refine focus._",
    "",
  );

  return lines.join("\n");
}