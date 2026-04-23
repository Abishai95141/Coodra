import { type CreateDbOptions, createDb, type DbHandle } from '@contextos/db';

import type { DbClient } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/db.ts` — typed factory for the per-process
 * DB client that flows into `ToolContext.db`.
 *
 * Contract:
 *   - The factory is called exactly once at boot in `src/index.ts`.
 *     The returned `DbClient` is handed to `ToolRegistry` inside the
 *     `ContextDeps` bag; every tool invocation receives it through
 *     `ctx.db`. Tools never call `@contextos/db::createDb` directly.
 *   - `DbClient.db` is typed as `unknown` at the ToolContext
 *     boundary (see `tool-context.ts`) to keep the driver choice out
 *     of the ToolContext interface. This file re-exports the
 *     concrete `DbHandle` for lib-internal consumers (lib/sqlite-vec,
 *     lib/context-pack, …) that need the Drizzle instance typed.
 *   - `close()` is idempotent: a second call is a no-op. The
 *     `index.ts` shutdown hook and error paths both call it; the
 *     registry does not.
 *
 * Mode dispatch: delegates to `@contextos/db::createDb`, which honours
 * `options.mode` / `CONTEXTOS_MODE`. S7a consumes solo SQLite; S7b/c
 * will start exercising team Postgres for integration tests in S17.
 *
 * Factory pattern (S7a user directive): no module-level DB instance
 * is exported. Each `createDbClient` call opens a fresh handle so
 * tests can instantiate per-suite DBs without leakage through a
 * hidden singleton.
 */

const dbLibLogger = createMcpLogger('lib-db');

/**
 * Discriminated handle internal to the mcp-server lib layer. Exposes
 * the strongly-typed Drizzle client and raw driver to sibling lib
 * modules (`lib/sqlite-vec.ts`, `lib/context-pack.ts`) that need more
 * than the `ToolContext` boundary allows. Tool code MUST NOT import
 * this — that is the job of `ctx.db.db: unknown` + domain methods on
 * the sibling lib clients.
 */
export type InternalDbHandle = DbHandle;

export interface CreateDbClientOptions extends CreateDbOptions {
  /**
   * Marker used by the stdout-purity integration test to spin up a
   * throwaway `:memory:` DB. Not used in production — `index.ts`
   * passes nothing and lets `createDb` pick up `CONTEXTOS_MODE`.
   */
  readonly _testOverrideInMemory?: boolean;
}

/**
 * Opens the DB handle and returns a `DbClient` usable as
 * `ToolContext.db`. Also returns the strongly-typed `InternalDbHandle`
 * for lib-internal siblings via the returned object shape
 * (`asInternalHandle()` method) — this keeps `DbClient` narrow at
 * the public boundary while preserving Drizzle typing inside lib/*.
 */
export interface CreatedDbClient {
  readonly client: DbClient;
  /**
   * Access the concrete `DbHandle` (sqlite or postgres) for lib
   * modules that need the typed Drizzle driver. The registry never
   * calls this; only other lib/* files do.
   */
  asInternalHandle(): InternalDbHandle;
}

export function createDbClient(options: CreateDbClientOptions = {}): CreatedDbClient {
  const { _testOverrideInMemory, ...dbOptions } = options;
  const handle: DbHandle = _testOverrideInMemory
    ? createDb({
        mode: 'solo',
        sqlite: { path: ':memory:', loadVecExtension: false, skipPragmas: true },
      })
    : createDb(dbOptions);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      if (handle.kind === 'sqlite') {
        handle.close();
      } else {
        await handle.close();
      }
    } catch (err) {
      dbLibLogger.warn(
        { event: 'db_close_failed', kind: handle.kind, err: err instanceof Error ? err.message : String(err) },
        'db handle close threw; swallowing (shutdown path)',
      );
    }
  };

  dbLibLogger.info({ event: 'db_client_opened', kind: handle.kind }, 'db client opened');

  const client: DbClient = {
    db: handle.db,
    close,
  };

  return {
    client,
    asInternalHandle: () => handle,
  };
}
