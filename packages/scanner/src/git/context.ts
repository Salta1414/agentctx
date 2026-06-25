import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface GitContext {
  branch: string | null;
  changedFiles: string[];
  recentCommitFiles: string[];
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function getGitContext(projectRoot: string): GitContext {
  const root = resolve(projectRoot);
  if (!existsSync(join(root, ".git"))) {
    return { branch: null, changedFiles: [], recentCommitFiles: [] };
  }

  const branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = runGit(root, ["status", "--porcelain"]);
  const changedFiles = porcelain
    ? [
        ...new Set(
          porcelain
            .split("\n")
            .filter(Boolean)
            .map((line) => line.slice(3).trim().replace(/\\/g, "/")),
        ),
      ]
    : [];

  const recentCommitFiles: string[] = [];
  const log = runGit(root, ["log", "-3", "--name-only", "--pretty=format:"]);
  if (log) {
    for (const line of log.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("commit")) {
        recentCommitFiles.push(trimmed.replace(/\\/g, "/"));
      }
    }
  }

  return {
    branch: branch && branch !== "HEAD" ? branch : null,
    changedFiles,
    recentCommitFiles: [...new Set(recentCommitFiles)],
  };
}