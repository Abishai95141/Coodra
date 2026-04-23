import type { Logger } from '@contextos/shared';

import type { DbClient, FeaturePackStore } from '../framework/tool-context.js';
import { NotImplementedError } from './errors.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/feature-pack.ts` — factory for the
 * Feature-Pack store wired into `ToolContext.featurePack`.
 *
 * S7a scope: the factory returns a fully-typed object whose methods
 * throw `NotImplementedError('feature-pack')`. The filesystem-first
 * loader + checksum-guarded cache + inheritance resolver land in S7c
 * (see Module 02 implementation plan §S7c). The factory signature is
 * locked now so the ToolContext bag produced in `src/index.ts` has
 * every slot populated with the correct type, not `null` or
 * `undefined`. Tool handlers typing against `ctx.featurePack` will
 * keep compiling across the S7a → S7c swap.
 *
 * Why not wait until S7c to create the file? Because `ContextDeps`
 * is frozen in S7a (user directive) — the filesystem shape (`src/lib/
 * <name>.ts`) must match the ToolContext slot names on day one so
 * that S7c is a function-body change, not a file addition.
 */

const featurePackLogger = createMcpLogger('lib-feature-pack');

export interface CreateFeaturePackStoreDeps {
  readonly db: DbClient;
  /** Optional override for tests; defaults to the lib-feature-pack logger. */
  readonly logger?: Logger;
}

export function createFeaturePackStore(deps: CreateFeaturePackStoreDeps): FeaturePackStore {
  if (!deps?.db) {
    throw new TypeError('createFeaturePackStore: deps.db is required');
  }
  const log = deps.logger ?? featurePackLogger;
  log.debug({ event: 'feature_pack_store_created' }, 'feature-pack store stub created (S7c will land the real impl)');

  return {
    async get(_args) {
      throw new NotImplementedError('feature-pack.get');
    },
    async list(_args) {
      throw new NotImplementedError('feature-pack.list');
    },
    async upsert(_pack) {
      throw new NotImplementedError('feature-pack.upsert');
    },
  };
}
