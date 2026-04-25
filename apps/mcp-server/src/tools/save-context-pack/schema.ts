import { z } from 'zod';

/**
 * Input schema for `contextos__save_context_pack` (§24.4).
 *
 * `projectId` is NOT in the caller's input; the handler resolves it
 * from `runs.projectId` via the `runId`. This matches §24.4 and
 * keeps the agent-facing surface small.
 *
 * `featurePackId` is accepted but currently discarded by the S7c
 * `ContextPackStore` (no FK column on `context_packs` yet). Kept in
 * the input per §24.4 so M05/M07 schema growth can persist the
 * association without breaking the tool contract.
 *
 * Size caps are defensive — oversize → Zod validation failure →
 * registry's generic `invalid_input` envelope. Not a structured
 * soft-failure: invalid input is a client bug, not a user-recoverable
 * state.
 */

const MAX_TITLE = 512 as const;
const MAX_CONTENT = 1_048_576 as const; // 1 MiB in JS string length.

export const saveContextPackInputSchema = z
  .object({
    runId: z.string().min(1, 'runId is required').max(256),
    title: z.string().min(1, 'title is required').max(MAX_TITLE, `title must be at most ${MAX_TITLE} characters`),
    content: z
      .string()
      .min(1, 'content is required')
      .max(MAX_CONTENT, `content must be at most ${MAX_CONTENT} characters (~1 MiB)`),
    featurePackId: z.string().min(1).max(256).optional(),
  })
  .strict()
  .describe('Input for contextos__save_context_pack.');

/**
 * Output schema — discriminated union on `ok` per §9.1.2 canonical
 * soft-failure shape. Success includes `contentExcerpt` (the Unicode
 * code-point-safe excerpt the store already computed) so the agent
 * can confirm persisted content without a second read.
 */
const successBranch = z
  .object({
    ok: z.literal(true),
    contextPackId: z.string().min(1),
    savedAt: z.string().datetime().describe('ISO 8601 timestamp the context_packs row was inserted.'),
    contentExcerpt: z.string(),
  })
  .strict();

const runNotFoundBranch = z
  .object({
    ok: z.literal(false),
    error: z.literal('run_not_found'),
    howToFix: z.string().min(1),
  })
  .strict();

export const saveContextPackOutputSchema = z.union([successBranch, runNotFoundBranch]);

export type SaveContextPackInput = z.infer<typeof saveContextPackInputSchema>;
export type SaveContextPackOutput = z.infer<typeof saveContextPackOutputSchema>;
