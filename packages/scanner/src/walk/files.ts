import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCANNABLE_EXT } from "../constants/extensions.js";
import { DEFAULT_IGNORED_SEGMENTS, isRepoIgnoredPath } from "../ignore.js";
import { toPosixPath } from "../utils/paths.js";

export function walkSourceFiles(
  projectRoot: string,
  extraIgnore: string[] = [],
): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (DEFAULT_IGNORED_SEGMENTS.has(entry.name)) continue;

      const full = join(dir, entry.name);
      const relPath = toPosixPath(full.slice(projectRoot.length + 1));
      if (isRepoIgnoredPath(relPath, extraIgnore)) continue;

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (!SCANNABLE_EXT.has(ext)) continue;

      results.push(relPath);
    }
  }

  walk(projectRoot);
  return results.sort();
}
