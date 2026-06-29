import { join } from "node:path";
import Database from "better-sqlite3";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import { indexProject, openIndexHandle } from "@niryn/indexer-node";
import { ensureProjectRow } from "../db/cbm-bridge.js";
import { initSchemaV2 } from "../db/schema-v2.js";
import { cbmProjectKeyFromRoot } from "../db/cbm-bridge.js";
import { rebuildRelationCache, rebuildSymbolCache } from "../graph/cache.js";

export interface RunIndexOptions {
  projectRoot: string;
  projectId: string;
  name: string;
  specVersion?: string;
  full?: boolean;
  dbPath?: string;
}

export interface RunIndexResult {
  nodeCount: number;
  edgeCount: number;
  symbolCacheCount: number;
  relationCacheCount: number;
}

export async function runIndexer(options: RunIndexOptions): Promise<RunIndexResult> {
  const dbPath = options.dbPath ?? join(options.projectRoot, AGENTCTX_DIR, "context.db");
  const db = new Database(dbPath);
  initSchemaV2(db);
  ensureProjectRow(db, {
    id: options.projectId,
    rootPath: options.projectRoot,
    name: options.name,
    specVersion: options.specVersion ?? "2.0.0",
    indexerVersion: "niryn-indexer-0.2.0",
  });
  db.close();

  const indexResult = await indexProject({
    dbPath,
    projectRoot: options.projectRoot,
    projectId: options.projectId,
    full: options.full ?? true,
  });

  const handle = openIndexHandle(dbPath, options.projectRoot, options.projectId);
  const db2 = new Database(dbPath);
  const symbolCacheCount = rebuildSymbolCache(db2, options.projectId, handle);
  const relationCacheCount = rebuildRelationCache(db2, options.projectId, handle);
  db2.close();
  handle.close();

  return {
    nodeCount: indexResult.nodeCount,
    edgeCount: indexResult.edgeCount,
    symbolCacheCount,
    relationCacheCount,
  };
}

export { cbmProjectKeyFromRoot };
