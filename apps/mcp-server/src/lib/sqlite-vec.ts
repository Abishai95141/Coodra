import type { Logger } from '@contextos/shared';

import type { DbClient, SqliteVecClient } from '../framework/tool-context.js';
import { NotImplementedError } from './errors.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/sqlite-vec.ts` — factory for the
 * sqlite-vec client wired into `ToolContext.sqliteVec`.
 *
 * User constraint (S7a): this is a DOMAIN-shaped API, not a raw
 * query executor. The only method exposed by `SqliteVecClient` is
 * `searchSimilarPacks({ embedding, k, filter? })` — no `run(sql,
 * params)`. Growing the surface is the right kind of work; opening
 * a SQL back door is not.
 *
 * Why enforce this separation? Three reasons pulled directly from
 * `system-architecture.md` §5 and §24.8:
 *   1. Every tool's manifest description is an agent prompt. If
 *      handlers could execute arbitrary SQL through `ctx.sqliteVec`,
 *      we could never honestly tell an agent "this tool only reads
 *      context_packs_vec" — we'd have no static proof of that.
 *   2. Rate limiting + policy enforcement + audit all hook on the
 *      domain method names (`searchSimilarPacks`), not on SQL
 *      substrings. Keeping SQL inside the lib module preserves that
 *      single attack surface.
 *   3. The sqlite-vec brute-force-KNN gotcha (see `External api and
 *      library reference.md`) is documented once here, not
 *      re-derived by every handler author.
 *
 * S7a methods throw `NotImplementedError('sqlite-vec.*')`. S7c
 * (§S11 `search_packs_nl`) lands the real `searchSimilarPacks`
 * body + an integration test that inserts a 384-d embedding and
 * KNN-queries it back.
 */

const sqliteVecLogger = createMcpLogger('lib-sqlite-vec');

export interface CreateSqliteVecClientDeps {
  readonly db: DbClient;
  readonly logger?: Logger;
}

export function createSqliteVecClient(deps: CreateSqliteVecClientDeps): SqliteVecClient {
  if (!deps?.db) {
    throw new TypeError('createSqliteVecClient: deps.db is required');
  }
  const log = deps.logger ?? sqliteVecLogger;
  log.debug({ event: 'sqlite_vec_client_created' }, 'sqlite-vec client stub created (S7c will land the real impl)');

  return {
    async searchSimilarPacks(_query) {
      throw new NotImplementedError('sqlite-vec.searchSimilarPacks');
    },
  };
}
