import { z } from 'zod';

/**
 * Input + output schemas for `contextos__query_codebase_graph` (§24.4, S15).
 *
 * §24.4's input is `{ projectSlug: string, query: string }`. S15 ships
 * the M02-accurate output shape: `{ ok: true, nodes, edges, indexed,
 * notice? }` rather than §24.4's richer `{ symbols: [...] }` — the
 * rich `symbols` projection lands with Module 05 when graphify node
 * shape becomes typed (today `unknown`). §24.4 is amended same-commit.
 *
 * Query filtering is deferred to Module 05 per user Q4 sign-off 2026-
 * 04-24: the M02 handler accepts `query` but does NOT filter (nodes
 * are `unknown`; a stringify-substring match would be imprecise and
 * costly). Success responses that hit an indexed project carry
 * `notice: 'query_filtering_deferred_to_m05'` so agents can detect the
 * M02 shim. Same pattern as `search_packs_nl`'s `no_embeddings_yet`.
 *
 * Two soft-failure shapes (user carryover — the "two distinct
 * soft-failures" split):
 *   - `project_not_found`         — projectSlug not registered.
 *   - `codebase_graph_not_indexed` — project exists but no
 *                                    graph.json on disk.
 * Distinct remediation paths:
 *   project_not_found  →  run `contextos init` for this project
 *   codebase_graph_not_indexed → run `graphify scan` at repo root
 *
 * Empty results (index present, zero matching nodes at M02's
 * full-return path) are `{ ok: true, nodes: [], edges: [],
 * indexed: true, notice: 'query_filtering_deferred_to_m05' }` — NOT
 * a soft-failure.
 */

export const queryCodebaseGraphInputSchema = z
  .object({
    projectSlug: z.string().min(1, 'projectSlug is required').max(256),
    query: z.string().min(1, 'query is required').max(2048),
  })
  .strict()
  .describe('Input for contextos__query_codebase_graph.');

const successBranch = z
  .object({
    ok: z.literal(true),
    nodes: z.array(z.unknown()),
    edges: z.array(z.unknown()),
    /**
     * `true` when `getIndexStatus(slug)` returned `{ present: true }`.
     * `nodes`/`edges` may still be empty (valid empty subgraph,
     * unreadable file mid-read, malformed JSON — all of which the
     * lib layer handles by returning empty arrays while keeping
     * `indexed: true`). Distinct from the soft-failure
     * `codebase_graph_not_indexed` which fires when the file is
     * missing entirely.
     */
    indexed: z.literal(true),
    /**
     * Advisory marker — present whenever the handler returns a full
     * subgraph without applying `query` filtering. Full filtering is
     * deferred to Module 05 (typed node schema). Agents read this to
     * distinguish M02 full-return from Module-05 query-filtered return.
     */
    notice: z.literal('query_filtering_deferred_to_m05').optional(),
  })
  .strict();

const projectNotFoundBranch = z
  .object({
    ok: z.literal(false),
    error: z.literal('project_not_found'),
    howToFix: z.string().min(1),
  })
  .strict();

const codebaseGraphNotIndexedBranch = z
  .object({
    ok: z.literal(false),
    error: z.literal('codebase_graph_not_indexed'),
    howToFix: z.string().min(1),
  })
  .strict();

export const queryCodebaseGraphOutputSchema = z.union([
  successBranch,
  projectNotFoundBranch,
  codebaseGraphNotIndexedBranch,
]);

export type QueryCodebaseGraphInput = z.infer<typeof queryCodebaseGraphInputSchema>;
export type QueryCodebaseGraphOutput = z.infer<typeof queryCodebaseGraphOutputSchema>;
