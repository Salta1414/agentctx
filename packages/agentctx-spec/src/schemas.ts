import { z } from "zod";
import { REF_STATUSES } from "./constants.js";

export const manifestIndexerSchema = z.object({
  name: z.string(),
  version: z.string(),
  cbm_fork: z.string().optional(),
});

export const manifestSchema = z.object({
  spec_version: z.string(),
  project: z.object({
    name: z.string(),
    root: z.string(),
  }),
  generator: z.object({
    name: z.string(),
    version: z.string(),
  }),
  indexer: manifestIndexerSchema.optional(),
  last_full_scan: z.string(),
  last_incremental_scan: z.string().optional(),
  stack: z.array(z.string()),
  stats: z.object({
    files: z.number(),
    symbols: z.number(),
    features: z.number(),
    tests: z.number(),
    languages: z.array(z.string()).optional(),
    cbm_nodes: z.number().optional(),
    cbm_edges: z.number().optional(),
  }),
  export_profile: z.enum(["full", "summary"]).optional(),
  export_note: z.string().optional(),
  billing_slot_id: z.string().optional(),
});

export const contextPackRequestSchema = z.object({
  project_root: z.string().optional(),
  task: z.string().optional(),
  focus_file: z.string().optional(),
  focus_symbol: z.string().optional(),
  active_file: z.string().optional(),
  include_git_context: z.boolean().optional(),
  profile: z.enum(["cheap", "balanced", "deep"]).optional(),
  limits: z
    .object({
      max_files: z.number().optional(),
      max_symbols: z.number().optional(),
      max_tests: z.number().optional(),
      max_snippet_bytes: z.number().optional(),
    })
    .optional(),
});

export const refStatusSchema = z.enum(REF_STATUSES);
