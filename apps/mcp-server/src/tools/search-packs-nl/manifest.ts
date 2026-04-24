import type { IdempotencyKeyBuilder } from '../../framework/idempotency.js';
import type { ToolRegistration } from '../../framework/tool-registry.js';

import { createSearchPacksNlHandler, type SearchPacksNlHandlerDeps } from './handler.js';
import { type SearchPacksNlInput, searchPacksNlInputSchema, searchPacksNlOutputSchema } from './schema.js';

/**
 * Registration factory for `contextos__search_packs_nl` (§24.4).
 *
 * Factory-shaped because the handler closes over a `DbHandle` for
 * projects-slug resolution + context_packs IN-JOIN (semantic) +
 * LIKE fallback. Semantic KNN itself goes through `ctx.sqliteVec`.
 *
 * Description is §24.4 verbatim with one added sentence naming the
 * LIKE fallback and the `no_embeddings_yet` notice per the S11
 * slice amendment. §24.3 anatomy is enforced by
 * `@contextos/shared/test-utils::assertManifestDescriptionValid`.
 */

const searchPacksNlIdempotencyKey: IdempotencyKeyBuilder<SearchPacksNlInput> = (input, _ctx) => {
  // Readonly: the registry skips DB-backed dedupe but logs the key
  // for correlation. Different queries on the same project collide
  // after truncation — fine for log-correlation (not dedup-critical).
  const slug = typeof input?.projectSlug === 'string' && input.projectSlug.length > 0 ? input.projectSlug : 'probe';
  const queryPrefix = typeof input?.query === 'string' ? input.query.slice(0, 60) : '';
  const hasEmbedding = Array.isArray(input?.embedding) && input.embedding.length > 0 ? '1' : '0';
  return {
    kind: 'readonly',
    key: `readonly:search_packs_nl:${slug}:e${hasEmbedding}:${queryPrefix}`.slice(0, 200),
  };
};

export function createSearchPacksNlToolRegistration(
  deps: SearchPacksNlHandlerDeps,
): ToolRegistration<typeof searchPacksNlInputSchema, typeof searchPacksNlOutputSchema> {
  return {
    name: 'search_packs_nl',
    title: 'ContextOS: search_packs_nl',
    description:
      'Call this when the user asks "what was done before?", "has X been tried?", or "what is the current state of Y?" — or when you are unsure whether work on a topic already exists. ' +
      'Natural-language search across all prior Context Packs in this project, ranked by relevance. ALWAYS call this before answering questions about prior state from memory. ' +
      'Returns { ok: true, packs: [...] } on success. If caller supplies an embedding, semantic cosine-distance ranking is used; otherwise a LIKE fallback over title + excerpt returns results with ' +
      'notice: "no_embeddings_yet" + howToFix. Soft-failures: project_not_found, embedding_dim_mismatch.',
    inputSchema: searchPacksNlInputSchema,
    outputSchema: searchPacksNlOutputSchema,
    idempotencyKey: searchPacksNlIdempotencyKey,
    handler: createSearchPacksNlHandler(deps),
  };
}
