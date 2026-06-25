export const SPEC_VERSION = "1.0.0" as const;

export const DEFAULT_API_PORT = 47321;

export const AGENTCTX_DIR = ".agentctx";

/** User-captured project decisions from chat or tools (not overwritten on scan). */
export const DECISIONS_FILE = "decisions.json";

export const MAX_PROJECT_DECISIONS = 100;

export const DEFAULT_PACK_LIMITS = {
  max_files: 10,
  max_symbols: 18,
  max_tests: 5,
  max_snippet_bytes: 48_000,
} as const;

/** Default context-pack routing profile when callers omit `profile`. */
export const DEFAULT_PACK_PROFILE = "balanced" as const;

/** Reference tokenizer profile for token estimates (cl100k_base family). */
export const DEFAULT_TOKEN_MODEL = "gpt-4o" as const;

export const REF_STATUSES = [
  "valid",
  "changed",
  "missing",
  "suspicious",
  "outdated",
] as const;