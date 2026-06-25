import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: [
    "better-sqlite3",
    "tree-sitter",
    "tree-sitter-typescript",
    "tree-sitter-python",
  ],
});