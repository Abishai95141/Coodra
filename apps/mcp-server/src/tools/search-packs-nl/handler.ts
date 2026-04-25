import { type DbHandle, postgresSchema, sqliteSchema } from '@contextos/db';
import { createLogger, EMBEDDING_DIM } from '@contextos/shared';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import type { ToolContext } from '../../framework/tool-context.js';
import type { PackResult, SearchPacksNlInput, SearchPacksNlOutput } from './schema.js';

/**
 * Handler factory for `contextos__search_packs_nl` (§24.4 + S11 slice).
 *
 * Factory shape because the handler closes over a `DbHandle` for
 * the projects-slug lookup, the context_packs IN-JOIN after semantic
 * KNN, and the LIKE fallback query. Semantic KNN goes through
 * `ctx.sqliteVec.searchSimilarPacks` — the S7c dual-path surface
 * (sqlite-vec vec0 for solo, pgvector `<=>` for team).
 *
 * Flow:
 *
 *   1. Resolve `projectSlug` → `projects.id`. Missing → structured
 *      `{ ok: false, error: 'project_not_found', howToFix }`.
 *      No auto-create — this is a read tool (contrast S8's
 *      `get_run_id` which bootstraps in solo mode).
 *
 *   2. If `embedding` supplied AND `length === EMBEDDING_DIM`:
 *        - Semantic path. Convert `number[]` → `Float32Array`.
 *        - Call `ctx.sqliteVec.searchSimilarPacks({ embedding, k,
 *          filter: { projectSlug } })` — returns `[{ packId,
 *          distance }]` in distance-ascending order.
 *        - IN-JOIN against `context_packs` to hydrate metadata.
 *        - Preserve the distance-sorted order when mapping back.
 *        - Return `{ ok: true, packs: [...] }` (no notice).
 *
 *   3. If `embedding` supplied but `length !== EMBEDDING_DIM`:
 *        - Return `{ ok: false, error: 'embedding_dim_mismatch',
 *          expected, got, howToFix }` BEFORE calling the store.
 *          Handler-level check rather than Zod-level because the
 *          `invalid_input` envelope the registry produces for Zod
 *          failures is too generic — callers need a structured code.
 *
 *   4. If `embedding` NOT supplied (the M02 common case — no NL
 *      Assembly yet to pre-compute):
 *        - LIKE fallback: `SELECT id, title, content_excerpt,
 *          created_at, run_id FROM context_packs WHERE project_id =
 *          ? AND (LOWER(title) LIKE ? OR LOWER(content_excerpt) LIKE
 *          ?) ORDER BY created_at DESC LIMIT ?`.
 *        - Return `{ ok: true, packs: [...], notice:
 *          'no_embeddings_yet', howToFix: '...' }`.
 *          `score` is `null` per row (no semantic distance to
 *          report; caller agent should not rank by score when
 *          notice is present).
 *
 * Defaults: `limit` defaults to 10 if unspecified.
 */

const handlerLogger = createLogger('mcp-server.tool.search_packs_nl');

const DEFAULT_LIMIT = 10 as const;

const NO_EMBEDDINGS_HOWTO =
  'Module 05 (NL Assembly) will populate summary_embedding on save, enabling semantic search. Until then, this tool falls back to LIKE text search over title + content_excerpt.' as const;

const PROJECT_NOT_FOUND_HOWTO =
  'Register this project via the Web App or run `contextos init` in the project root before retrying.' as const;

export interface SearchPacksNlHandlerDeps {
  readonly db: DbHandle;
}

async function resolveProjectId(db: DbHandle, projectSlug: string): Promise<string | null> {
  if (db.kind === 'sqlite') {
    const rows = await db.db
      .select({ id: sqliteSchema.projects.id })
      .from(sqliteSchema.projects)
      .where(eq(sqliteSchema.projects.slug, projectSlug))
      .limit(1);
    return rows[0]?.id ?? null;
  }
  const rows = await db.db
    .select({ id: postgresSchema.projects.id })
    .from(postgresSchema.projects)
    .where(eq(postgresSchema.projects.slug, projectSlug))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Hydrate pack metadata for a set of context_pack ids, preserving hit order + attaching distance as score. */
async function hydrateSemanticHits(
  db: DbHandle,
  hits: ReadonlyArray<{ readonly packId: string; readonly distance: number }>,
): Promise<ReadonlyArray<PackResult>> {
  if (hits.length === 0) return [];
  const ids = hits.map((h) => h.packId);

  type Row = {
    readonly id: string;
    readonly title: string;
    readonly contentExcerpt: string;
    readonly createdAt: Date;
    readonly runId: string | null;
  };

  let rows: Row[];
  if (db.kind === 'sqlite') {
    rows = (await db.db
      .select({
        id: sqliteSchema.contextPacks.id,
        title: sqliteSchema.contextPacks.title,
        contentExcerpt: sqliteSchema.contextPacks.contentExcerpt,
        createdAt: sqliteSchema.contextPacks.createdAt,
        runId: sqliteSchema.contextPacks.runId,
      })
      .from(sqliteSchema.contextPacks)
      .where(inArray(sqliteSchema.contextPacks.id, ids as string[]))) as Row[];
  } else {
    rows = (await db.db
      .select({
        id: postgresSchema.contextPacks.id,
        title: postgresSchema.contextPacks.title,
        contentExcerpt: postgresSchema.contextPacks.contentExcerpt,
        createdAt: postgresSchema.contextPacks.createdAt,
        runId: postgresSchema.contextPacks.runId,
      })
      .from(postgresSchema.contextPacks)
      .where(inArray(postgresSchema.contextPacks.id, ids as string[]))) as Row[];
  }

  const rowById = new Map<string, Row>();
  for (const r of rows) rowById.set(r.id, r);

  const packs: PackResult[] = [];
  for (const hit of hits) {
    const row = rowById.get(hit.packId);
    if (!row) continue; // vec0 row without a context_packs row — shouldn't happen but fail-open
    if (row.runId === null) continue; // context_packs.run_id is technically notNull but defensive
    packs.push({
      id: row.id,
      title: row.title,
      excerpt: row.contentExcerpt,
      score: hit.distance,
      savedAt: row.createdAt.toISOString(),
      runId: row.runId,
    });
  }
  return packs;
}

async function likeFallbackSearch(
  db: DbHandle,
  projectId: string,
  query: string,
  limit: number,
): Promise<ReadonlyArray<PackResult>> {
  const needle = `%${query.toLowerCase()}%`;

  type Row = {
    readonly id: string;
    readonly title: string;
    readonly contentExcerpt: string;
    readonly createdAt: Date;
    readonly runId: string | null;
  };

  let rows: Row[];
  if (db.kind === 'sqlite') {
    const cp = sqliteSchema.contextPacks;
    rows = (await db.db
      .select({
        id: cp.id,
        title: cp.title,
        contentExcerpt: cp.contentExcerpt,
        createdAt: cp.createdAt,
        runId: cp.runId,
      })
      .from(cp)
      .where(
        and(
          eq(cp.projectId, projectId),
          or(sql`LOWER(${cp.title}) LIKE ${needle}`, sql`LOWER(${cp.contentExcerpt}) LIKE ${needle}`),
        ),
      )
      .orderBy(desc(cp.createdAt))
      .limit(limit)) as Row[];
  } else {
    const cp = postgresSchema.contextPacks;
    rows = (await db.db
      .select({
        id: cp.id,
        title: cp.title,
        contentExcerpt: cp.contentExcerpt,
        createdAt: cp.createdAt,
        runId: cp.runId,
      })
      .from(cp)
      .where(
        and(
          eq(cp.projectId, projectId),
          or(sql`LOWER(${cp.title}) LIKE ${needle}`, sql`LOWER(${cp.contentExcerpt}) LIKE ${needle}`),
        ),
      )
      .orderBy(desc(cp.createdAt))
      .limit(limit)) as Row[];
  }

  const packs: PackResult[] = [];
  for (const row of rows) {
    if (row.runId === null) continue;
    packs.push({
      id: row.id,
      title: row.title,
      excerpt: row.contentExcerpt,
      score: null,
      savedAt: row.createdAt.toISOString(),
      runId: row.runId,
    });
  }
  return packs;
}

export function createSearchPacksNlHandler(deps: SearchPacksNlHandlerDeps) {
  if (!deps || typeof deps !== 'object') {
    throw new TypeError('createSearchPacksNlHandler requires a deps object');
  }
  if (!deps.db || typeof deps.db !== 'object' || !('kind' in deps.db)) {
    throw new TypeError('createSearchPacksNlHandler: deps.db must be a DbHandle');
  }

  return async function searchPacksNlHandler(
    input: SearchPacksNlInput,
    ctx: ToolContext,
  ): Promise<SearchPacksNlOutput> {
    const projectId = await resolveProjectId(deps.db, input.projectSlug);
    if (projectId === null) {
      handlerLogger.info(
        { event: 'search_packs_nl_project_not_found', projectSlug: input.projectSlug, sessionId: ctx.sessionId },
        'search_packs_nl: projectSlug does not match a projects row — returning soft-failure',
      );
      return {
        ok: false,
        error: 'project_not_found',
        howToFix: PROJECT_NOT_FOUND_HOWTO,
      };
    }

    const limit = input.limit ?? DEFAULT_LIMIT;

    // Embedding-supplied branch.
    if (input.embedding !== undefined) {
      if (input.embedding.length !== EMBEDDING_DIM) {
        handlerLogger.info(
          {
            event: 'search_packs_nl_dim_mismatch',
            projectSlug: input.projectSlug,
            expected: EMBEDDING_DIM,
            got: input.embedding.length,
            sessionId: ctx.sessionId,
          },
          'search_packs_nl: embedding length mismatch — returning soft-failure',
        );
        return {
          ok: false,
          error: 'embedding_dim_mismatch',
          expected: EMBEDDING_DIM,
          got: input.embedding.length,
          howToFix: `Supply an exactly ${EMBEDDING_DIM}-dimensional Float32 embedding. Module 02 does not compute embeddings; Module 05 NL Assembly will be the default producer.`,
        };
      }

      const embedding = Float32Array.from(input.embedding);
      const hits = await ctx.sqliteVec.searchSimilarPacks({
        embedding,
        k: limit,
        filter: { projectSlug: input.projectSlug },
      });
      const packs = await hydrateSemanticHits(deps.db, hits);
      return {
        ok: true,
        packs: packs as PackResult[],
      };
    }

    // LIKE fallback — no embedding supplied.
    const packs = await likeFallbackSearch(deps.db, projectId, input.query, limit);
    return {
      ok: true,
      packs: packs as PackResult[],
      notice: 'no_embeddings_yet',
      howToFix: NO_EMBEDDINGS_HOWTO,
    };
  };
}
