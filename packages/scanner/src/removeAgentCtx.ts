import { existsSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AGENTCTX_DIR } from "@niryn/agentctx-spec";

export function removeAgentCtx(projectRoot: string): boolean {
  const root = resolve(projectRoot);
  const agentCtxPath = join(root, AGENTCTX_DIR);
  const rel = relative(root, agentCtxPath);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Refusing to delete .agentctx outside the project root.");
  }

  if (!existsSync(agentCtxPath)) {
    return false;
  }

  rmSync(agentCtxPath, { recursive: true, force: true });
  return true;
}
