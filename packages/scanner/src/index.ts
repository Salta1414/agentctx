export {
  runScan,
  type ScanOptions,
  type ScanProgress,
  type ScanResult,
} from "./scan.js";
export {
  runIncrementalScan,
  type IncrementalScanOptions,
  type IncrementalScanResult,
} from "./incremental.js";
export {
  verifyContextRefs,
  type RefVerification,
  type VerifyRefsResult,
} from "./verify-refs.js";
export { initAgentCtx, type InitResult } from "./init.js";
export { removeAgentCtx } from "./removeAgentCtx.js";
export { getGitContext, type GitContext } from "./git/context.js";
export { sha256 } from "./utils/hash.js";
export {
  DEFAULT_IGNORED_SEGMENTS,
  isAllowedSourcePath,
  isRepoIgnoredPath,
} from "./ignore.js";
export { isScannablePath } from "./constants/extensions.js";
export { writeIndexIgnoreFile } from "./indexer/ignore-bridge.js";
export { loadConfig } from "./features/detect.js";
export { initSchemaV2 } from "./db/schema-v2.js";
export { cbmProjectKeyFromRoot, ensureProjectRow } from "./db/cbm-bridge.js";
export {
  openGraphView,
  CbmGraphView,
} from "./graph/cbm-view.js";
export type {
  GraphView,
  GraphViewOptions,
  GraphSymbol,
  GraphRelation,
  GraphFeature,
  GraphFile,
  TraceNode,
  SemanticHit,
  ChangeImpact,
} from "./graph/view.js";
export { rebuildSymbolCache, rebuildRelationCache } from "./graph/cache.js";
export { cbmLabelToKind, cbmEdgeToRelation, mapCbmNodeToGraphSymbol } from "./graph/map-cbm.js";
export { runIndexer, type RunIndexOptions, type RunIndexResult } from "./indexer/run-index.js";
export {
  downgradeV2ToV1,
  dropLegacyTables,
  migrateV1ToV2,
  remapFeatureEntrypoints,
  runMigrateProject,
  type MigrationResult,
} from "./migrate/v1-to-v2.js";

import { runScan, type ScanOptions, type ScanResult } from "./scan.js";

/** @deprecated Use runScan */
export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  return runScan(options);
}
