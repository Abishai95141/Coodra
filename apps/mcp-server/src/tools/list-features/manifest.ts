import type { IdempotencyKeyBuilder } from '../../framework/idempotency.js';
import type { ToolRegistration } from '../../framework/tool-registry.js';

import { createListFeaturesHandler, type ListFeaturesHandlerDeps } from './handler.js';
import {
  type ListFeaturesInput,
  listFeaturesInputSchema,
  listFeaturesOutputSchema,
} from './schema.js';

/**
 * Registration factory for `contextos__list_features`.
 *
 * Read-only — idempotency kind is `read` so the registry doesn't dedupe
 * across separate calls (every list query gets a fresh roundtrip; the
 * cost is bounded by the indexer's idempotent regen-on-read).
 *
 * The description follows the §24.3 five-part recipe (imperative
 * trigger / return shape / why / when-NOT / hand-off). The agent uses
 * the returned descriptions to decide which features to load via
 * `contextos__get_feature`; that's the central skill-pattern handshake.
 */

const listFeaturesIdempotencyKey: IdempotencyKeyBuilder<ListFeaturesInput> = (input, ctx) => {
  const slug = typeof input?.projectSlug === 'string' && input.projectSlug.length > 0 ? input.projectSlug : 'unknown';
  return {
    kind: 'readonly',
    key: `list_features:${slug}:${ctx.sessionId}`.slice(0, 200),
  };
};

export function createListFeaturesToolRegistration(
  deps: ListFeaturesHandlerDeps,
): ToolRegistration<typeof listFeaturesInputSchema, typeof listFeaturesOutputSchema> {
  return {
    name: 'list_features',
    title: 'ContextOS: list_features',
    description:
      'Call this once per session to discover the skill-style features available for the project — each feature is a self-contained ' +
      'knowledge unit (description + body + supporting files) the agent can load on demand. Returns ' +
      '{ ok: true, features: [{slug, description, whenNotToUse, maturity, fileCount, ...}] } sorted by slug, OR a soft-failure ' +
      'with project_not_found / project_cwd_unknown / features_dir_missing for new projects. Read each entry\'s description, ' +
      'then call get_feature(slug) ONLY for the ones whose triggers match the current task — do not load every feature blindly. ' +
      'Re-run when the user mentions a topic you don\'t recognise.',
    inputSchema: listFeaturesInputSchema,
    outputSchema: listFeaturesOutputSchema,
    idempotencyKey: listFeaturesIdempotencyKey,
    handler: createListFeaturesHandler(deps),
  };
}
