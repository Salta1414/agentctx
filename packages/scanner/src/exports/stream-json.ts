import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export function writeJsonFile(path: string, data: unknown, pretty = true): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  writeFileSync(path, `${body}\n`, "utf8");
}

/**
 * Write `{ "key": [ ...items ] }` without building one giant string.
 * Accepts any iterable so callers avoid allocating a mapped copy of huge arrays.
 */
export function writeJsonArrayFile(
  path: string,
  key: string,
  items: Iterable<unknown>,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w");
  try {
    writeSync(fd, `{\n  ${JSON.stringify(key)}: [\n`);
    let i = 0;
    for (const item of items) {
      const prefix = i === 0 ? "    " : ",\n    ";
      writeSync(fd, prefix + JSON.stringify(item));
      i++;
    }
    writeSync(fd, i > 0 ? "\n  ]\n}\n" : "  ]\n}\n");
  } finally {
    closeSync(fd);
  }
}