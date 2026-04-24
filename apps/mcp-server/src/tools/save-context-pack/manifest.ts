import type { IdempotencyKeyBuilder } from '../../framework/idempotency.js';
import type { ToolRegistration } from '../../framework/tool-registry.js';

import { createSaveContextPackHandler, type SaveContextPackHandlerDeps } from './handler.js';
import { type SaveContextPackInput, saveContextPackInputSchema, saveContextPackOutputSchema } from './schema.js';

/**
 * Registration factory for `contextos__save_context_pack` (§24.4).
 *
 * Factory shape because the handler closes over a `DbHandle` for the
 * `runs` lookup + UPDATE. The context_packs write itself goes through
 * `ctx.contextPack` (already on `ContextDeps`). Description is §24.4
 * verbatim (92 words — inside the 120-word hard cap).
 */

const saveContextPackIdempotencyKey: IdempotencyKeyBuilder<SaveContextPackInput> = (input, _ctx) => {
  // Per S7c/S10 rule: key on runId alone — the store dedupes per-
  // runId (append-only), so same-runId-different-content retries
  // collapse to the same logical operation. Log correlator only;
  // not used for DB dedupe (the context_packs unique index on
  // runId is the enforcer).
  const runId = typeof input?.runId === 'string' && input.runId.length > 0 ? input.runId : 'probe';
  return {
    kind: 'mutating',
    key: `save_context_pack:${runId}`.slice(0, 200),
  };
};

export function createSaveContextPackToolRegistration(
  deps: SaveContextPackHandlerDeps,
): ToolRegistration<typeof saveContextPackInputSchema, typeof saveContextPackOutputSchema> {
  return {
    name: 'save_context_pack',
    title: 'ContextOS: save_context_pack',
    description:
      'Call this when a feature, bug fix, or refactor is complete — not per small edit, once per completed task. ' +
      "Persists a markdown summary of what was built, decisions made, files modified, test results, and open TODOs to the project's context archive. " +
      'This is the ONLY mechanism by which the next session (possibly a different agent) can know what was done. ' +
      'Skipping this leaves the run as dead weight in the history table. Returns { contextPackId, savedAt, contentExcerpt } on success, or ' +
      '{ ok: false, error: "run_not_found", howToFix } if the runId is not registered. Append-only: same runId + different content returns the original row.',
    inputSchema: saveContextPackInputSchema,
    outputSchema: saveContextPackOutputSchema,
    idempotencyKey: saveContextPackIdempotencyKey,
    handler: createSaveContextPackHandler(deps),
  };
}
