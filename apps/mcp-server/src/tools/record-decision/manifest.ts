import { createHash } from 'node:crypto';

import type { IdempotencyKeyBuilder } from '../../framework/idempotency.js';
import type { ToolRegistration } from '../../framework/tool-registry.js';

import { createRecordDecisionHandler, type RecordDecisionHandlerDeps } from './handler.js';
import { type RecordDecisionInput, recordDecisionInputSchema, recordDecisionOutputSchema } from './schema.js';

/**
 * Registration factory for `contextos__record_decision` (§24.4, S13).
 *
 * Factory-shaped because the handler closes over a `DbHandle` for the
 * `runs` lookup + `decisions` INSERT (see `handler.ts` docblock).
 *
 * The registry's idempotency-key surface is mutating — the key
 * mirrors the handler's dedupe shape
 * (`dec:{runId}:{sha256(description).slice(0,32)}`) so the request log
 * shows the same key an agent's retry would emit. The registry itself
 * does not dedupe on this key; dedupe is enforced by the
 * `decisions.idempotency_key` UNIQUE constraint inside the handler.
 * Mismatch would hide retries in the log.
 *
 * §24.3 description anatomy (five-part recipe + 40–80 word band) is
 * enforced by `@contextos/shared/test-utils::assertManifestDescriptionValid`
 * in the unit suite — do NOT hand-roll per-tool anatomy assertions.
 */

const recordDecisionIdempotencyKey: IdempotencyKeyBuilder<RecordDecisionInput> = (input, _ctx) => {
  const runId = typeof input?.runId === 'string' && input.runId.length > 0 ? input.runId : 'probe';
  const description = typeof input?.description === 'string' ? input.description : '';
  const hash = createHash('sha256').update(description).digest('hex').slice(0, 32);
  return {
    kind: 'mutating',
    key: `dec:${runId}:${hash}`.slice(0, 200),
  };
};

export function createRecordDecisionToolRegistration(
  deps: RecordDecisionHandlerDeps,
): ToolRegistration<typeof recordDecisionInputSchema, typeof recordDecisionOutputSchema> {
  return {
    name: 'record_decision',
    title: 'ContextOS: record_decision',
    description:
      'Call this IMMEDIATELY after choosing a library, designing an API shape, selecting an implementation approach over an alternative, or deciding NOT to implement something. ' +
      'Persists a permanent decision entry with description, rationale, and alternatives considered. Future sessions will see these decisions and must not contradict them silently. ' +
      'Do not batch decisions — log each one as it is made. Idempotent on (runId, description): retry with identical description returns the first decisionId with created:false. ' +
      'Returns { ok: true, decisionId, createdAt, created } on success, or { ok: false, error: "run_not_found", howToFix } if the runId is not registered.',
    inputSchema: recordDecisionInputSchema,
    outputSchema: recordDecisionOutputSchema,
    idempotencyKey: recordDecisionIdempotencyKey,
    handler: createRecordDecisionHandler(deps),
  };
}
