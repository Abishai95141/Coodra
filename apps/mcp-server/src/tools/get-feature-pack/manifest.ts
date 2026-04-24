import type { IdempotencyKeyBuilder } from '../../framework/idempotency.js';
import type { ToolRegistration } from '../../framework/tool-registry.js';

import { getFeaturePackHandler } from './handler.js';
import { type GetFeaturePackInput, getFeaturePackInputSchema, getFeaturePackOutputSchema } from './schema.js';

/**
 * Registration for `contextos__get_feature_pack`.
 *
 * Static const (not a factory) per §9.1.1 common-patterns: the
 * handler consumes `ctx.featurePack` which is already wired into
 * `ContextDeps` at boot — no process-level config (db, mode, env)
 * needs to be closed over here.
 *
 * Description is verbatim from `system-architecture.md §24.4`. §24.3
 * anatomy is enforced by `@contextos/shared/test-utils::
 * assertManifestDescriptionValid` in the unit tests.
 */

const getFeaturePackIdempotencyKey: IdempotencyKeyBuilder<GetFeaturePackInput> = (input, _ctx) => {
  // Read-only: the registry skips DB-backed dedupe for readonly keys
  // but still logs the key for correlation. Caller-supplied
  // projectSlug + filePath (or '*' sentinel) differentiate the
  // path-scoped call from the whole-pack call. `_ctx` is part of the
  // `IdempotencyKeyBuilder` contract but unused here — the readonly
  // key is input-derived only.
  const slug = typeof input?.projectSlug === 'string' && input.projectSlug.length > 0 ? input.projectSlug : 'probe';
  const path = typeof input?.filePath === 'string' && input.filePath.length > 0 ? input.filePath : '*';
  return {
    kind: 'readonly',
    key: `readonly:get_feature_pack:${slug}:${path}`.slice(0, 200),
  };
};

export const getFeaturePackToolRegistration: ToolRegistration<
  typeof getFeaturePackInputSchema,
  typeof getFeaturePackOutputSchema
> = {
  name: 'get_feature_pack',
  title: 'ContextOS: get_feature_pack',
  description:
    'Call this BEFORE editing, creating, or refactoring any file in this project. Returns the Feature Pack for the ' +
    'module that owns the given path: architectural constraints, coding conventions, permitted files, known ' +
    "gotchas, and the tech lead's guidelines. Always call on the first tool use of a session and whenever switching " +
    'to a new area of the codebase. Without this, your changes will probably violate conventions the team has ' +
    'already recorded.',
  inputSchema: getFeaturePackInputSchema,
  outputSchema: getFeaturePackOutputSchema,
  idempotencyKey: getFeaturePackIdempotencyKey,
  handler: getFeaturePackHandler,
};
