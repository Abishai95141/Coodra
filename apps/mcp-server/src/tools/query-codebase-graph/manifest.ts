import type { IdempotencyKeyBuilder } from '../../framework/idempotency.js';
import type { ToolRegistration } from '../../framework/tool-registry.js';

import { createQueryCodebaseGraphHandler, type QueryCodebaseGraphHandlerDeps } from './handler.js';
import {
  type QueryCodebaseGraphInput,
  queryCodebaseGraphInputSchema,
  queryCodebaseGraphOutputSchema,
} from './schema.js';

/**
 * Registration factory for `contextos__query_codebase_graph` (§24.4, S15).
 *
 * Factory shape (user Q1 sign-off 2026-04-24) closes over `DbHandle`
 * for projects-slug resolution — needed to distinguish the two
 * soft-failure shapes (`project_not_found` vs `codebase_graph_not_indexed`).
 * Handler reads `ctx.graphify` for the index-status probe + the
 * slug-addressed subgraph load (S15 additive method).
 *
 * Read-only tool — idempotency key is kind `readonly`. Shape:
 *   `readonly:query_codebase_graph:{slug}:{query.slice(0,60)}`
 * Different (slug, query) combos yield distinct log keys so retries
 * correlate without collapsing two distinct reads. Registry does not
 * dedupe on readonly keys.
 *
 * §24.3 description anatomy (five-part recipe + 40–80 word band) is
 * enforced by `@contextos/shared/test-utils::assertManifestDescriptionValid`.
 */

const queryCodebaseGraphIdempotencyKey: IdempotencyKeyBuilder<QueryCodebaseGraphInput> = (input, _ctx) => {
  const slug = typeof input?.projectSlug === 'string' && input.projectSlug.length > 0 ? input.projectSlug : 'probe';
  const query = typeof input?.query === 'string' ? input.query.slice(0, 60) : '';
  return {
    kind: 'readonly',
    key: `readonly:query_codebase_graph:${slug}:${query}`.slice(0, 200),
  };
};

export function createQueryCodebaseGraphToolRegistration(
  deps: QueryCodebaseGraphHandlerDeps,
): ToolRegistration<typeof queryCodebaseGraphInputSchema, typeof queryCodebaseGraphOutputSchema> {
  return {
    name: 'query_codebase_graph',
    title: 'ContextOS: query_codebase_graph',
    description:
      "Call this BEFORE making significant structural changes to understand the code's dependency graph. " +
      'Returns symbol-level relationships (who calls what, who depends on what) from the Graphify-indexed codebase. ' +
      'Use to find blast radius before refactoring, to locate the correct module for a new feature, or to answer ' +
      '"where is X defined?" without reading every file. Returns { ok: true, nodes, edges, indexed: true, notice } ' +
      'on success (query filtering is deferred to Module 05). Soft-failures: project_not_found (unknown slug), ' +
      'codebase_graph_not_indexed (project exists but `graphify scan` has not been run).',
    inputSchema: queryCodebaseGraphInputSchema,
    outputSchema: queryCodebaseGraphOutputSchema,
    idempotencyKey: queryCodebaseGraphIdempotencyKey,
    handler: createQueryCodebaseGraphHandler(deps),
  };
}
