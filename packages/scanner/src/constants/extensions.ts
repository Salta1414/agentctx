import { INDEXABLE_EXT_SET } from "@niryn/indexer-node";

export const SCANNABLE_EXT = INDEXABLE_EXT_SET;

export function isScannablePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return SCANNABLE_EXT.has(path.slice(dot).toLowerCase());
}
