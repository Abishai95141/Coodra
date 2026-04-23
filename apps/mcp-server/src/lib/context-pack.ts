import type { Logger } from '@contextos/shared';

import type { ContextPackStore, DbClient } from '../framework/tool-context.js';
import { NotImplementedError } from './errors.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/context-pack.ts` — factory for the
 * Context-Pack store wired into `ToolContext.contextPack`.
 *
 * S7a contract (user directive Q3): `write(pack, embedding)` accepts
 * the embedding vector as `Float32Array | null`. The store NEVER
 * computes an embedding itself — that is Module 04's
 * responsibility. `null` is a first-class value: the pack is still
 * persisted (for text-search fallback via `search_packs_nl`'s LIKE
 * path) and the embedding column is written as SQL `NULL`.
 *
 * S7a scope: methods throw `NotImplementedError('context-pack.*')`.
 * The real impl lands in S7c (§S10 `save_context_pack` + §S11
 * `search_packs_nl`). The factory signature is locked now so:
 *
 *   - `ContextDeps.contextPack` is populated at boot with a real
 *     object, not a sentinel `null` that every call site would
 *     otherwise have to branch on;
 *   - S10's handler code can be written against the final
 *     signature today and verified against the real factory the
 *     minute S7c lands.
 *
 * Embedding-dim assertion: the real S7c impl will `assertEq(
 * embedding?.length, EMBEDDING_DIM)` using `@contextos/shared`'s
 * `EMBEDDING_DIM` constant (384). Documenting it here so the
 * contract is written down before the code exists.
 */

const contextPackLogger = createMcpLogger('lib-context-pack');

export interface CreateContextPackStoreDeps {
  readonly db: DbClient;
  readonly logger?: Logger;
}

export function createContextPackStore(deps: CreateContextPackStoreDeps): ContextPackStore {
  if (!deps?.db) {
    throw new TypeError('createContextPackStore: deps.db is required');
  }
  const log = deps.logger ?? contextPackLogger;
  log.debug({ event: 'context_pack_store_created' }, 'context-pack store stub created (S7c will land the real impl)');

  return {
    async write(_pack, _embedding) {
      throw new NotImplementedError('context-pack.write');
    },
    async read(_runId) {
      throw new NotImplementedError('context-pack.read');
    },
    async list(_filter) {
      throw new NotImplementedError('context-pack.list');
    },
  };
}
