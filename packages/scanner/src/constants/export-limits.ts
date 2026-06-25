/** Limits for JSON sidecar exports — SQLite graph stays complete. */
export const SCAN_EXPORT_LIMITS = {
  /** Above this: drop called_by / imports_from from symbol exports. */
  FULL_SYMBOL_DETAIL_MAX: 25_000,
  /** Stream JSON arrays instead of single stringify. */
  STREAM_ARRAY_MIN: 256,
  /** Max entries in refs/registry.json (exported symbols only). */
  REGISTRY_MAX: 50_000,
  /** Max file paths listed per feature in features.json. */
  FEATURE_FILES_MAX: 2_000,
  /** Max callers stored per symbol when detail mode is on. */
  CALLED_BY_MAX: 32,
  /** Truncate long signatures in summary exports. */
  SIGNATURE_MAX_LEN: 240,
  /** Cap ambiguous call resolution (e.g. shared names like `get`, `run`). */
  CALL_TARGETS_MAX_PER_NAME: 48,
  /** Cap call edges recorded per source file. */
  CALL_RELATIONS_MAX_PER_FILE: 2_000,
} as const;

export type ExportProfile = "full" | "summary";

export function exportProfileForSymbolCount(count: number): ExportProfile {
  return count > SCAN_EXPORT_LIMITS.FULL_SYMBOL_DETAIL_MAX ? "summary" : "full";
}