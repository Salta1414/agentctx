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
export { parseSource } from "./parse/index.js";
export { getGitContext, type GitContext } from "./git/context.js";
export { sha256 } from "./utils/hash.js";
export {
  DEFAULT_IGNORED_SEGMENTS,
  isAllowedSourcePath,
  isRepoIgnoredPath,
} from "./ignore.js";
export { loadConfig } from "./features/detect.js";

import { runScan, type ScanOptions, type ScanResult } from "./scan.js";

/** @deprecated Use runScan */
export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  return runScan(options);
}
