import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { RefStatus } from "@niryn/agentctx-spec";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";
import { getProject, rebuildExportsFromDb } from "./db/rebuild.js";
import { initSchemaV2 } from "./db/schema-v2.js";
import { sha256 } from "./utils/hash.js";
import { normalizeProjectRoot } from "./utils/paths.js";

export interface RefVerification {
  id: string;
  path: string;
  symbol: string | null;
  status: RefStatus;
  previous_status: RefStatus;
}

export interface VerifyRefsResult {
  projectRoot: string;
  verified_at: string;
  total: number;
  stale_count: number;
  refs: RefVerification[];
}

export function verifyContextRefs(projectRoot: string): VerifyRefsResult {
  const root = normalizeProjectRoot(projectRoot);
  const dbPath = join(root, AGENTCTX_DIR, "context.db");
  const verifiedAt = new Date().toISOString();

  const db = new Database(dbPath);
  initSchemaV2(db);

  const project = getProject(db, root);
  if (!project) {
    db.close();
    throw new Error(`No scan data for ${root}. Run \`niryn scan\` first.`);
  }

  const refs = db
    .prepare(
      `SELECT id, path, symbol, signature, content_hash, status
       FROM context_refs`,
    )
    .all() as Array<{
    id: string;
    path: string;
    symbol: string | null;
    signature: string;
    content_hash: string;
    status: string;
  }>;

  const updateRef = db.prepare(
    `UPDATE context_refs SET status = ?, last_verified = ? WHERE id = ?`,
  );

  const results: RefVerification[] = [];
  let staleCount = 0;

  for (const ref of refs) {
    const previous = ref.status as RefStatus;
    const status = verifySingleRef(root, ref.path, ref.content_hash);
    if (status !== "valid") staleCount++;
    updateRef.run(status, verifiedAt, ref.id);
    results.push({
      id: ref.id,
      path: ref.path,
      symbol: ref.symbol,
      status,
      previous_status: previous,
    });
  }

  rebuildExportsFromDb(db, project.id, root, verifiedAt);
  db.prepare(`UPDATE projects SET last_incremental_scan = ? WHERE id = ?`).run(
    verifiedAt,
    project.id,
  );
  db.close();

  return {
    projectRoot: root,
    verified_at: verifiedAt,
    total: results.length,
    stale_count: staleCount,
    refs: results,
  };
}

function verifySingleRef(
  projectRoot: string,
  relPath: string,
  storedHash: string,
): RefStatus {
  const abs = join(projectRoot, relPath);
  if (!existsSync(abs)) return "missing";

  try {
    const content = readFileSync(abs, "utf8");
    return sha256(content) === storedHash ? "valid" : "changed";
  } catch {
    return "suspicious";
  }
}
