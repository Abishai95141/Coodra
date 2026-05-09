import type { IdempotencyKeyBuilder } from '../../framework/idempotency.js';
import type { ToolRegistration } from '../../framework/tool-registry.js';

import { createGetFeatureHandler, type GetFeatureHandlerDeps } from './handler.js';
import { type GetFeatureInput, getFeatureInputSchema, getFeatureOutputSchema } from './schema.js';

const getFeatureIdempotencyKey: IdempotencyKeyBuilder<GetFeatureInput> = (input, ctx) => {
  const slug = typeof input?.slug === 'string' && input.slug.length > 0 ? input.slug : 'unknown';
  const proj = typeof input?.projectSlug === 'string' && input.projectSlug.length > 0 ? input.projectSlug : 'unknown';
  return {
    kind: 'readonly',
    key: `get_feature:${proj}:${slug}:${ctx.sessionId}`.slice(0, 200),
  };
};

export function createGetFeatureToolRegistration(
  deps: GetFeatureHandlerDeps,
): ToolRegistration<typeof getFeatureInputSchema, typeof getFeatureOutputSchema> {
  return {
    name: 'get_feature',
    title: 'ContextOS: get_feature',
    description:
      'Call this AFTER list_features identifies a feature whose trigger description matches the current task — never blindly pre-load. ' +
      'Returns { ok: true, slug, frontmatter, body, files: [{path, bytes, modifiedAt}] } where `body` is the full feature.md ' +
      'content (markdown, expect 1-30 KB) and `files` lists supporting documents. Soft-failure: project_not_found / project_cwd_unknown / feature_not_found, each with howToFix. ' +
      'Supporting file CONTENTS are not included — call get_feature_file(slug, path) per file to fetch those, gated by extension and size. ' +
      'Re-call when switching to a new feature mid-session.',
    inputSchema: getFeatureInputSchema,
    outputSchema: getFeatureOutputSchema,
    idempotencyKey: getFeatureIdempotencyKey,
    handler: createGetFeatureHandler(deps),
  };
}
