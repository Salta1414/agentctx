import type { REF_STATUSES } from "./constants.js";

export type RefStatus = (typeof REF_STATUSES)[number];

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "const"
  | "route"
  | "model";

export type RelationKind =
  | "imports"
  | "calls"
  | "depends_on"
  | "tests"
  | "exports_to"
  | "belongs_to";

export type ExportProfile = "full" | "summary";

export interface ManifestIndexer {
  name: string;
  version: string;
  cbm_fork?: string;
}

export interface Manifest {
  spec_version: string;
  project: { name: string; root: string };
  generator: { name: string; version: string };
  indexer?: ManifestIndexer;
  last_full_scan: string;
  last_incremental_scan?: string;
  stack: string[];
  stats: {
    files: number;
    symbols: number;
    features: number;
    tests: number;
    languages?: string[];
    cbm_nodes?: number;
    cbm_edges?: number;
  };
  /** Present on large repos: JSON maps may be summarized. */
  export_profile?: ExportProfile;
  export_note?: string;
  /** Stable billing slot id — survives rescans; bound to the user account on the server. */
  billing_slot_id?: string;
}

export type PackTrackSource = "mcp" | "api" | "desktop" | "cli" | "baseline" | "none";

export type PackProfile = "cheap" | "balanced" | "deep";

export type DecisionStatus = "active" | "superseded";

export type DecisionSource = "chat" | "manual" | "mcp" | "api";

export type ContextOutcomeStatus = "accepted" | "edited" | "reverted" | "failed";

export type AgentIntentSource = "api" | "cli" | "mcp" | "desktop";

export type ContextOutcomeWarningType =
  | "generated_output_touched"
  | "outside_pack_or_intent"
  | "high_impact_without_tests"
  | "no_proof_for_touched_file";

export type ContextOutcomeWarningSeverity = "info" | "warning" | "critical";

export interface ContextOutcomeWarning {
  type: ContextOutcomeWarningType;
  severity: ContextOutcomeWarningSeverity;
  message: string;
  path?: string;
}

export type ContextTestResultStatus = "passed" | "failed" | "unknown";

export interface ContextTestResult {
  command: string;
  exit_code: number | null;
  status: ContextTestResultStatus;
  duration_ms?: number;
  signal?: string;
}

export interface ContextAgentCommandResult {
  command: string;
  exit_code: number | null;
  signal?: string;
  duration_ms?: number;
}

export interface ContextDiffStats {
  files_changed: number;
  additions: number;
  deletions: number;
  truncated: boolean;
}

export interface PackDiagnosisProofGap {
  path: string;
  reason:
    | "not_in_pack"
    | "outside_intent"
    | "no_proof_graph_edge"
    | "generated_output"
    | "high_impact_without_tests";
  severity: ContextOutcomeWarningSeverity;
  message: string;
}

export interface PackDiagnosisBoostedFile {
  path: string;
  reason:
    | "missing_context"
    | "intent_drift"
    | "generated_output"
    | "high_impact";
  score: number;
}

export interface PackDiagnosis {
  score: number;
  summary: string;
  proof_gaps: PackDiagnosisProofGap[];
  boosted_files: PackDiagnosisBoostedFile[];
}

export interface ProjectDecision {
  id: string;
  at: string;
  status: DecisionStatus;
  summary: string;
  rationale?: string;
  tags: string[];
  /** Topic keywords this decision replaces (e.g. "stripe"). */
  supersedes: string[];
  related_paths?: string[];
  constraints?: string[];
  avoid_terms?: string[];
  boost_paths?: string[];
  pin_paths?: string[];
  source?: DecisionSource;
}

export interface DecisionsSnapshot {
  spec_version: string;
  decisions: ProjectDecision[];
}

export interface RecordDecisionRequest {
  summary: string;
  rationale?: string;
  tags?: string[];
  supersedes?: string[];
  related_paths?: string[];
  constraints?: string[];
  avoid_terms?: string[];
  boost_paths?: string[];
  pin_paths?: string[];
  source?: DecisionSource;
}

export interface RecordContextOutcomeRequest {
  project_root?: string;
  pack_run_id?: string;
  intent_id?: string;
  task?: string;
  agent?: string;
  model?: string;
  outcome?: ContextOutcomeStatus;
  pack_generated_at?: string;
  /** Defaults to true when files_touched is omitted: infer touched files from git delta since the pack run. */
  infer_files_touched?: boolean;
  files_read?: string[];
  files_touched?: string[];
  tests_run?: string[];
  test_results?: ContextTestResult[];
  agent_command?: ContextAgentCommandResult;
  rounds?: number;
  extra_context_tokens?: number;
  success_score?: number;
}

export interface RecordAgentIntentRequest {
  project_root?: string;
  pack_run_id?: string;
  task?: string;
  agent?: string;
  model?: string;
  source?: AgentIntentSource;
  planned_files_read?: string[];
  planned_files_edit?: string[];
  planned_tests?: string[];
}

export interface AgentIntentContract {
  id: string;
  at: string;
  pack_run_id?: string;
  task?: string;
  agent?: string;
  model?: string;
  source?: AgentIntentSource;
  planned_files_read: string[];
  planned_files_edit: string[];
  planned_tests: string[];
}

export interface AgentIntentDraft {
  pack_run_id?: string;
  task?: string;
  planned_files_read: string[];
  planned_files_edit: string[];
  planned_tests: string[];
  notes: string[];
}

export interface AgentIntentDrift {
  intent_id: string;
  planned_files_read: string[];
  planned_files_edit: string[];
  planned_tests: string[];
  undeclared_files_read: string[];
  undeclared_files_touched: string[];
  untouched_declared_files: string[];
  undeclared_tests_run: string[];
  unrun_declared_tests: string[];
  adherence: number | null;
}

export interface ContextOutcome {
  at: string;
  pack_run_id?: string;
  intent_id?: string;
  task?: string;
  agent?: string;
  model?: string;
  outcome: ContextOutcomeStatus;
  pack_generated_at?: string;
  inferred_files_touched: boolean;
  files_read: string[];
  files_touched: string[];
  tests_run: string[];
  pack_files: string[];
  git_changed_before?: string[];
  git_changed_after?: string[];
  precision: number | null;
  recall: number | null;
  missing_context: string[];
  intent_drift?: AgentIntentDrift;
  warnings?: ContextOutcomeWarning[];
  rounds?: number;
  extra_context_tokens?: number;
  success_score?: number;
  cost_to_success?: number;
}

export interface ContextQualityTotals {
  count: number;
  avg_precision: number | null;
  avg_recall: number | null;
  avg_intent_adherence: number | null;
  missing_context_count: number;
  intent_drift_count: number;
  undeclared_touched_count: number;
  recent_outcome_at: string | null;
  warning_count?: number;
  critical_warning_count?: number;
  avg_rounds?: number | null;
  avg_cost_to_success?: number | null;
  top_missing_context: Array<{
    path: string;
    count: number;
  }>;
  top_undeclared_touched: Array<{
    path: string;
    count: number;
  }>;
}

export interface ContextReplayRun {
  run_id: string;
  at: string;
  pack_run_id?: string;
  intent_id?: string;
  task?: string;
  agent?: string;
  model?: string;
  outcome: ContextOutcomeStatus;
  pack_files: string[];
  files_touched: string[];
  files_read: string[];
  tests_run: string[];
  test_results?: ContextTestResult[];
  agent_command?: ContextAgentCommandResult;
  missing_context: string[];
  intent_drift?: AgentIntentDrift;
  precision: number | null;
  recall: number | null;
  warnings: ContextOutcomeWarning[];
  rounds?: number;
  extra_context_tokens?: number;
  success_score?: number;
  cost_to_success?: number;
  git_diff?: string;
  diff_stats?: ContextDiffStats;
  diagnosis?: PackDiagnosis;
  savings?: {
    full_context_tokens?: number;
    pack_tokens: number;
    tokens_saved?: number;
    tokens_saved_percent?: number;
  };
}

export interface PackDecision {
  id: string;
  summary: string;
  tags: string[];
  rationale?: string;
  supersedes: string[];
  constraints?: string[];
  avoid_terms?: string[];
  boost_paths?: string[];
  pin_paths?: string[];
}

export interface ContextPackRequest {
  project_root?: string;
  task?: string;
  focus_file?: string;
  focus_symbol?: string;
  active_file?: string;
  include_git_context?: boolean;
  /** Context routing profile. cheap = smallest useful pack, deep = broader refactor pack. */
  profile?: PackProfile;
  /** Who triggered the pack — used for real savings tracking (baseline excluded). */
  track_source?: PackTrackSource;
  limits?: {
    max_files?: number;
    max_symbols?: number;
    max_tests?: number;
    max_snippet_bytes?: number;
  };
}

export interface PackItem {
  path?: string;
  name?: string;
  score: number;
  reason: string;
  status?: RefStatus;
}

export interface PackSnippet {
  path: string;
  kind: "symbol" | "file" | "test";
  name?: string;
  start_line: number;
  end_line: number;
  content: string;
  byte_size: number;
}

export interface PackCompilerTrace {
  profile: PackProfile;
  strategy: "context-router-v0";
  budget: {
    max_files: number;
    max_symbols: number;
    max_tests: number;
    max_snippet_bytes: number;
  };
  signals: Array<{
    source:
      | "task"
      | "focus_file"
      | "focus_symbol"
      | "active_file"
      | "git"
      | "decision"
      | "outcome"
      | "fallback";
    value: string;
    weight: number;
  }>;
  included_reasons: Array<{
    kind: "file" | "symbol" | "test";
    ref: string;
    score: number;
    reason: string;
    evidence: string[];
  }>;
  excluded_reasons: Array<{
    kind: "file" | "symbol";
    ref: string;
    score: number;
    reason: string;
  }>;
  must_include?: Array<{
    kind: "file" | "symbol" | "test";
    ref: string;
    reason: string;
    score: number;
  }>;
  ranked_include?: Array<{
    kind: "file" | "symbol" | "test";
    ref: string;
    reason: string;
    score: number;
  }>;
  excluded?: Array<{
    kind: "file" | "symbol" | "test";
    ref: string;
    reason: string;
    score?: number;
  }>;
  negative_context?: string[];
  proof_graph: {
    nodes: Array<{
      id: string;
      kind: "task" | "signal" | "reason" | "file" | "symbol" | "test";
      label: string;
      score?: number;
    }>;
    edges: Array<{
      from: string;
      to: string;
      relation: "matched" | "seeded" | "selected" | "covered_by";
      weight?: number;
    }>;
  };
  savings: {
    full_context_tokens: number;
    pack_tokens: number;
    tokens_saved: number;
    tokens_saved_percent: number;
  };
  learning?: {
    outcome_count: number;
    similar_outcome_count: number;
    boosted_files: Array<{
      path: string;
      score: number;
      reason: string;
    }>;
    missing_context_candidates: Array<{
      path: string;
      count: number;
    }>;
    avg_precision: number | null;
    avg_recall: number | null;
  };
}

export type ContextExpansionTargetKind = "file" | "symbol" | "feature" | "pack_run";

export type ContextExpansionMode =
  | "callers"
  | "imports"
  | "tests"
  | "same_feature"
  | "risks"
  | "decisions"
  | "auto";

export interface ContextExpansionRequest {
  project_root?: string;
  target: string;
  target_kind: ContextExpansionTargetKind;
  mode?: ContextExpansionMode;
  depth?: number;
  max_tokens?: number;
}

export interface ContextExpansion {
  spec_version: string;
  generated_at: string;
  target: string;
  target_kind: ContextExpansionTargetKind;
  mode: ContextExpansionMode;
  files: PackItem[];
  symbols: PackItem[];
  tests: PackItem[];
  snippets: PackSnippet[];
  negative_context: string[];
  token_estimate: number;
  proof_graph: PackCompilerTrace["proof_graph"];
}

export interface ContextBenchmarkTask {
  id: string;
  task: string;
  profile?: PackProfile;
  focus_file?: string;
  focus_symbol?: string;
  active_file?: string;
  expected_files?: string[];
  expected_symbols?: string[];
  expected_tests?: string[];
}

export interface ContextBenchmarkRequest {
  project_root?: string;
  tasks?: ContextBenchmarkTask[];
  profile?: PackProfile;
  include_git_context?: boolean;
}

export interface ContextBenchmarkResult {
  id: string;
  task: string;
  profile: PackProfile;
  success: boolean;
  success_score: number;
  estimated_rounds: number;
  pack_tokens: number;
  full_context_tokens: number;
  tokens_saved: number;
  tokens_saved_percent: number;
  cost_to_success: number;
  files_expected: string[];
  files_hit: string[];
  missing_files: string[];
  symbols_expected: string[];
  symbols_hit: string[];
  missing_symbols: string[];
  tests_expected: string[];
  tests_hit: string[];
  missing_tests: string[];
  pack_run_id?: string;
}

export interface ContextBenchmarkSuite {
  spec_version: string;
  generated_at: string;
  project_root: string;
  count: number;
  passed: number;
  avg_success_score: number;
  avg_estimated_rounds: number;
  avg_pack_tokens: number;
  avg_cost_to_success: number;
  results: ContextBenchmarkResult[];
}

export interface ContextPack {
  spec_version: string;
  run_id?: string;
  generated_at: string;
  task?: string;
  /** Context routing profile used by the compiler. */
  profile?: PackProfile;
  seeds: string[];
  files: PackItem[];
  symbols: PackItem[];
  tests: PackItem[];
  /** Ranked source excerpts included in the pack (what models should read). */
  snippets: PackSnippet[];
  snippet_bytes: number;
  risks: Array<{
    text: string;
    source: string;
    confidence: "high" | "medium" | "low";
  }>;
  /** Tokens counted from snippet content + pack metadata (cl100k_base). */
  token_estimate: number;
  overall_status: "valid" | "changed" | "degraded";
  /** Active project decisions included in this pack (intent from chat/tools). */
  decisions?: PackDecision[];
  /** Zero-latency draft an agent can submit or adjust before editing. */
  intent_draft?: AgentIntentDraft;
  /** Explainable compiler metadata for agents and UI. */
  compiler?: PackCompilerTrace;
}
