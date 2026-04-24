import { EMBEDDING_DIM } from '@contextos/shared';
import { z } from 'zod';

/**
 * Input schema for `contextos__search_packs_nl` (§24.4).
 *
 * §24.4 lists `{ projectSlug, query, limit? }`. This slice amends
 * §24.4 in-commit to add an optional `embedding: number[]` — Module
 * 02 does NOT compute embeddings (no NL Assembly yet; Module 05
 * owns that). Callers who can supply a pre-computed embedding get
 * the semantic path via `ctx.sqliteVec.searchSimilarPacks`; callers
 * who cannot get the LIKE fallback over `title` + `content_excerpt`
 * with a `notice: 'no_embeddings_yet'` + `howToFix` advisory.
 *
 * Dim validation is deliberately NOT at the Zod level — a length
 * mismatch returns a structured `embedding_dim_mismatch` soft-failure
 * (not the generic `invalid_input` envelope the registry produces
 * for Zod-rejected input). The handler performs the length check
 * and returns the canonical soft-failure shape per
 * `essentialsforclaude/09-common-patterns.md §9.1.2`.
 */

const MAX_QUERY_LEN = 4096 as const;
const MAX_LIMIT = 200 as const;

export const searchPacksNlInputSchema = z
  .object({
    projectSlug: z
      .string()
      .min(1, 'projectSlug is required')
      .max(128, 'projectSlug must be at most 128 characters')
      .describe('Project slug — same single-namespace convention as get_run_id / get_feature_pack.'),
    query: z
      .string()
      .min(1, 'query is required')
      .max(MAX_QUERY_LEN, `query must be at most ${MAX_QUERY_LEN} characters`)
      .describe('Natural-language query string. Used for the LIKE text fallback when no embedding is provided.'),
    embedding: z
      .array(z.number())
      .optional()
      .describe(
        `Pre-computed ${EMBEDDING_DIM}-dim embedding. Module 05 NL Assembly becomes the default caller that supplies this; M02 callers without an embedder get the LIKE fallback.`,
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .optional()
      .describe(`Max results (default 10, capped at ${MAX_LIMIT}).`),
  })
  .strict()
  .describe('Input for contextos__search_packs_nl.');

const packResultSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    excerpt: z.string(),
    /** Cosine distance from the query embedding; `null` on LIKE fallback rows. Lower = more relevant. */
    score: z.number().nullable(),
    savedAt: z.string().datetime(),
    runId: z.string().min(1),
  })
  .strict();

/**
 * Success branch — optional `notice` + `howToFix` on the LIKE
 * fallback path. The soft-failure convention (§9.1.2) mandates
 * `howToFix` for every `ok: false` branch; success-side advisory
 * notices are strictly additive and agent-callers branch on
 * `notice` presence to surface remediation to users.
 */
const successBranch = z
  .object({
    ok: z.literal(true),
    packs: z.array(packResultSchema),
    notice: z.literal('no_embeddings_yet').optional(),
    howToFix: z.string().min(1).optional(),
  })
  .strict();

const projectNotFoundBranch = z
  .object({
    ok: z.literal(false),
    error: z.literal('project_not_found'),
    howToFix: z.string().min(1),
  })
  .strict();

const embeddingDimMismatchBranch = z
  .object({
    ok: z.literal(false),
    error: z.literal('embedding_dim_mismatch'),
    expected: z.literal(EMBEDDING_DIM),
    got: z.number().int(),
    howToFix: z.string().min(1),
  })
  .strict();

export const searchPacksNlOutputSchema = z.union([successBranch, projectNotFoundBranch, embeddingDimMismatchBranch]);

export type SearchPacksNlInput = z.infer<typeof searchPacksNlInputSchema>;
export type SearchPacksNlOutput = z.infer<typeof searchPacksNlOutputSchema>;
export type PackResult = z.infer<typeof packResultSchema>;
