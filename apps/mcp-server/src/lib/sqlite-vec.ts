import { type DbHandle, postgresSchema, sqliteSchema } from '@contextos/db';
import { EMBEDDING_DIM, type Logger, ValidationError } from '@contextos/shared';
import { eq, sql } from 'drizzle-orm';

import type { SqliteVecClient } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/sqlite-vec.ts` — semantic-similarity
 * search backed by sqlite-vec (solo mode) or pgvector (team mode).
 *
 * Filename is retained from S7a to honor the "file tree frozen"
 * contract; despite the name this module is dialect-aware and also
 * handles the pgvector path. User directive Q8 approved the dual-
 * path implementation; rename deferred indefinitely.
 *
 * Domain surface (user constraint — no raw SQL executor):
 *
 *   - `searchSimilarPacks({ embedding, k, filter? })` — KNN search
 *     against the embedding store. Sqlite path uses the vec0 virtual
 *     table `context_packs_vec` created in migration 0001 (hand-
 *     written, sha256-locked) and `vec_distance_cosine` for cosine
 *     distance. Postgres path uses the pgvector `<=>` cosine
 *     operator with the HNSW index installed in migration 0001.
 *
 * Embedding dimension: every call validates `embedding.length ===
 * EMBEDDING_DIM` (384, sourced from `@contextos/shared`). A
 * mismatch throws `ValidationError` before any DB work.
 *
 * The `filter.projectSlug` scope is resolved to `projectId` via a
 * single `projects` row lookup. Missing slug → empty result.
 */

const sqliteVecLogger = createMcpLogger('lib-sqlite-vec');

export interface CreateSqliteVecClientDeps {
  readonly db: DbHandle;
  readonly logger?: Logger;
}

export function createSqliteVecClient(deps: CreateSqliteVecClientDeps): SqliteVecClient {
  if (!deps || typeof deps !== 'object') {
    throw new TypeError('createSqliteVecClient requires an options object');
  }
  if (!deps.db || typeof deps.db !== 'object' || !('kind' in deps.db)) {
    throw new TypeError('createSqliteVecClient: deps.db must be a DbHandle from @contextos/db');
  }
  const log = deps.logger ?? sqliteVecLogger;

  log.info(
    { event: 'sqlite_vec_client_wired', mode: deps.db.kind === 'sqlite' ? 'solo' : 'team' },
    'createSqliteVecClient: semantic-search client wired (dual-path sqlite-vec + pgvector).',
  );

  return {
    async searchSimilarPacks({ embedding, k, filter }) {
      if (!(embedding instanceof Float32Array)) {
        throw new ValidationError('sqlite-vec.searchSimilarPacks: embedding must be a Float32Array');
      }
      if (embedding.length !== EMBEDDING_DIM) {
        throw new ValidationError(
          `sqlite-vec.searchSimilarPacks: embedding length must be ${EMBEDDING_DIM}, got ${embedding.length}`,
        );
      }
      if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) {
        throw new ValidationError('sqlite-vec.searchSimilarPacks: k must be a positive finite number');
      }
      const limit = Math.min(Math.floor(k), 1000);

      if (deps.db.kind === 'sqlite') {
        // Resolve projectSlug → projectId if filter supplied.
        let projectId: string | null = null;
        if (filter?.projectSlug) {
          const rows = await deps.db.db
            .select({ id: sqliteSchema.projects.id })
            .from(sqliteSchema.projects)
            .where(eq(sqliteSchema.projects.slug, filter.projectSlug))
            .limit(1);
          if (!rows[0]) return [];
          projectId = rows[0].id;
        }

        // `vec_distance_cosine` is available on sqlite-vec 0.1.9 even
        // though the vec0 virtual table's inline `distance_metric=cosine`
        // was not accepted by that version (see sqlite-vec reference
        // gotchas). Brute-force query over context_packs_vec ordered
        // by cosine distance.
        const vecText = `[${Array.from(embedding).join(',')}]`;
        const baseQuery = projectId
          ? deps.db.raw.prepare(
              `SELECT v.context_pack_id AS packId, vec_distance_cosine(v.embedding, ?) AS distance
               FROM context_packs_vec v
               JOIN context_packs p ON p.id = v.context_pack_id
               WHERE p.project_id = ?
               ORDER BY distance ASC
               LIMIT ?`,
            )
          : deps.db.raw.prepare(
              `SELECT context_pack_id AS packId, vec_distance_cosine(embedding, ?) AS distance
               FROM context_packs_vec
               ORDER BY distance ASC
               LIMIT ?`,
            );
        const rows = projectId
          ? (baseQuery.all(vecText, projectId, limit) as Array<{ packId: string; distance: number }>)
          : (baseQuery.all(vecText, limit) as Array<{ packId: string; distance: number }>);
        return rows.map((r) => ({ packId: r.packId, distance: r.distance }));
      }

      // Postgres / pgvector path. The `<=>` operator computes cosine
      // distance when the `vector_cosine_ops` opclass backs the index
      // (migration 0001 HNSW preserve-block). The postgres-js driver
      // accepts the `[v1,v2,...]` text form for vector literals.
      const vectorLiteral = `[${Array.from(embedding).join(',')}]`;
      let projectId: string | null = null;
      if (filter?.projectSlug) {
        const rows = await deps.db.db
          .select({ id: postgresSchema.projects.id })
          .from(postgresSchema.projects)
          .where(eq(postgresSchema.projects.slug, filter.projectSlug))
          .limit(1);
        if (!rows[0]) return [];
        projectId = rows[0].id;
      }
      // Use a parameterised raw SQL through drizzle's sql template —
      // neither pg-core's typed query builder nor its operators bind
      // `<=>` against a vector column, so `sql.raw` + parameters is the
      // cleanest way to keep the query portable.
      const cp = postgresSchema.contextPacks;
      const base = projectId
        ? deps.db.db
            .select({
              packId: cp.id,
              distance: sql<number>`${cp.summaryEmbedding} <=> ${vectorLiteral}::vector(${EMBEDDING_DIM})`,
            })
            .from(cp)
            .where(eq(cp.projectId, projectId))
        : deps.db.db
            .select({
              packId: cp.id,
              distance: sql<number>`${cp.summaryEmbedding} <=> ${vectorLiteral}::vector(${EMBEDDING_DIM})`,
            })
            .from(cp);
      const rows = await base
        .orderBy(sql`${cp.summaryEmbedding} <=> ${vectorLiteral}::vector(${EMBEDDING_DIM})`)
        .limit(limit);
      return rows.map((r) => ({ packId: r.packId, distance: Number(r.distance) }));
    },
  };
}
