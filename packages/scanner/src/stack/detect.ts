import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function detectStack(projectRoot: string): string[] {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return ["javascript"];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const stack: string[] = [];

    if (deps.typescript) stack.push("typescript");
    else stack.push("javascript");

    if (deps.next) stack.push("nextjs");
    if (deps.react) stack.push("react");
    if (deps.vitest || deps.jest) stack.push("testing");
    if (deps.hono) stack.push("hono");
    if (deps.electron) stack.push("electron");

    return stack;
  } catch {
    return ["javascript"];
  }
}

export function projectName(projectRoot: string): string {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return projectRoot.split("/").pop() ?? "project";
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    return pkg.name?.replace(/^@/, "").replace(/\//g, "-") ?? "project";
  } catch {
    return projectRoot.split("/").pop() ?? "project";
  }
}