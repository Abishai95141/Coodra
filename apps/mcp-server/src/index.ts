// ---------------------------------------------------------------------------
// CRITICAL: this import must be FIRST, before anything else. It sets
// CONTEXTOS_LOG_DESTINATION=stderr so that when @contextos/shared's
// logger module is subsequently loaded (transitively via env.ts,
// tool-registry.ts, stdio.ts), it resolves its destination to fd 2.
// ES modules hoist imports, so only the order of `import` statements
// matters — no reordering tool should ever move this line.
// ---------------------------------------------------------------------------
import './bootstrap/ensure-stderr-logging.js';

import { randomUUID } from 'node:crypto';

import { ensurePgVector, migratePostgres, migrateSqlite } from '@contextos/db';
import { createLogger } from '@contextos/shared';

import { env } from './config/env.js';
import type { ContextDeps } from './framework/tool-context.js';
import { ToolRegistry } from './framework/tool-registry.js';
import { createAuthClient } from './lib/auth.js';
import { createContextPackStore } from './lib/context-pack.js';
import { createDbClient } from './lib/db.js';
import { createFeaturePackStore } from './lib/feature-pack.js';
import { createGraphifyClient } from './lib/graphify.js';
import { createMcpLogger } from './lib/logger.js';
import { createPolicyClient } from './lib/policy.js';
import { createRunRecorder } from './lib/run-recorder.js';
import { createSqliteVecClient } from './lib/sqlite-vec.js';
import { registerAllTools } from './tools/index.js';
import { type HttpTransportHandle, startHttpTransport } from './transports/http.js';
import { startStdioTransport } from './transports/stdio.js';

const bootLogger = createLogger('mcp-server.boot');

const SERVER_NAME = '@contextos/mcp-server' as const;
const SERVER_VERSION = '0.0.0' as const;

/**
 * Process entrypoint for `@contextos/mcp-server`.
 *
 * S7a scope (walking skeleton + frozen ToolContext):
 *   - stdio transport only (HTTP deferred to S16).
 *   - `ping` tool only (S8–S15 ship the eight real tools).
 *   - Full `ContextDeps` bag wired from `src/lib/*` factories, even
 *     though only `policy` is consumed at call time in S7a. The
 *     remaining lib clients (db, auth, featurePack, contextPack,
 *     runRecorder, sqliteVec, graphify) exist as stubs that throw
 *     `NotImplementedError` — their bodies fill in across S7b/c.
 *     Wiring them now locks the boot-order contract so S7b/c are
 *     function-body changes, not file additions.
 *
 * Layout invariants locked by this file:
 *   1. `./bootstrap/ensure-stderr-logging.js` is the first import.
 *   2. `env` is read from `./config/env.js` — the one module allowed
 *      to touch `process.env`.
 *   3. Each lib client is constructed via a `createXxx` factory
 *      from `./lib/*`; no module-level singletons cross the
 *      function boundary. This is the user S7a directive.
 *   4. The `ToolRegistry` is constructed once, with the built
 *      `ContextDeps` bag as `options.deps`. Handlers cannot opt out
 *      of policy because they never see an unwrapped call path.
 *   5. Graceful shutdown on SIGINT/SIGTERM — close the transport,
 *      close the DB, flush pino (stderr), exit 0.
 */
async function main(): Promise<void> {
  bootLogger.info(
    {
      event: 'boot',
      serverName: SERVER_NAME,
      serverVersion: SERVER_VERSION,
      mode: env.CONTEXTOS_MODE,
      logDestination: env.CONTEXTOS_LOG_DESTINATION,
      nodeEnv: env.NODE_ENV,
    },
    'starting @contextos/mcp-server',
  );

  // --- Build ContextDeps from the lib factories. -----------------------
  // Each `createXxx` is the ONLY entry point through which its
  // subsystem reaches the ToolContext. A swap (e.g. S7b replacing
  // dev-null policy with the cache-backed evaluator) is a single-
  // line change here.
  const sharedLogger = createMcpLogger('root');
  // CONTEXTOS_DB_OVERRIDE_MODE (verification finding §8.3 fix): if
  // explicitly set, override the env-derived team→Postgres routing.
  // Used for local dev that wants team-mode auth chain semantics + a
  // SQLite store. Default behaviour (no override) is unchanged.
  const dbClient = createDbClient(env.CONTEXTOS_DB_OVERRIDE_MODE ? { mode: env.CONTEXTOS_DB_OVERRIDE_MODE } : {});
  const dbHandle = dbClient.asInternalHandle();

  // ---------------------------------------------------------------------
  // Auto-migrate at boot. Both `migrateSqlite` and `migratePostgres` are
  // idempotent (drizzle tracks state in `__drizzle_migrations` and skips
  // already-applied migrations), so re-running on a warm DB is a no-op
  // by row count. For Postgres team mode we also run `CREATE EXTENSION
  // IF NOT EXISTS vector` BEFORE the migrator — migration 0000
  // references `vector(384)` and 0001's safety-net `CREATE EXTENSION`
  // runs too late on a brand-new database.
  //
  // Closes verification finding §8.1 — fresh users used to get
  // `SQLITE_ERROR: no such table: projects` on the first tool call.
  // ---------------------------------------------------------------------
  if (dbHandle.kind === 'sqlite') {
    migrateSqlite(dbHandle.db);
  } else {
    await ensurePgVector(dbHandle.db);
    await migratePostgres(dbHandle.db);
  }
  bootLogger.info({ event: 'migrations_applied', kind: dbHandle.kind }, 'migrations idempotent-applied at boot');

  const auth = createAuthClient(env);
  const policy = createPolicyClient({ db: dbHandle });
  const featurePack = createFeaturePackStore({ db: dbHandle });
  const contextPack = createContextPackStore({
    db: dbHandle,
    ...(env.CONTEXTOS_CONTEXT_PACKS_ROOT ? { contextPacksRoot: env.CONTEXTOS_CONTEXT_PACKS_ROOT } : {}),
  });
  const runRecorder = createRunRecorder({ db: dbHandle });
  const sqliteVec = createSqliteVecClient({ db: dbHandle });
  const graphify = createGraphifyClient({
    db: dbHandle,
    ...(env.CONTEXTOS_GRAPHIFY_ROOT ? { graphifyRoot: env.CONTEXTOS_GRAPHIFY_ROOT } : {}),
  });

  const deps: ContextDeps = Object.freeze({
    db: dbClient.client,
    logger: sharedLogger,
    auth,
    policy,
    featurePack,
    contextPack,
    runRecorder,
    sqliteVec,
    graphify,
  });

  const registry = new ToolRegistry({ deps });
  registerAllTools(registry, { db: dbHandle, mode: env.CONTEXTOS_MODE });

  // ---------------------------------------------------------------------
  // Transport selection (S16). `--transport` CLI flag overrides the env
  // setting `MCP_SERVER_TRANSPORT`; default `both`. The flag is parsed
  // here rather than in `config/env.ts` because env-only parsing would
  // make CLI-driven overrides require a wrapper script.
  // ---------------------------------------------------------------------
  const cliTransport = parseTransportFlag(process.argv.slice(2));
  const transportMode = cliTransport ?? env.MCP_SERVER_TRANSPORT;
  const startStdio = transportMode === 'stdio' || transportMode === 'both';
  const startHttp = transportMode === 'http' || transportMode === 'both';

  bootLogger.info(
    { event: 'transport_selection', transportMode, startStdio, startHttp },
    'transport selection resolved',
  );

  // Hyphen separator (not colon) — get_run_id rejects colon-bearing
  // sessionIds because its runId encoding uses `:` as the separator.
  const stdioSessionId = `stdio-${randomUUID()}`;
  const stdioHandle = startStdio
    ? await startStdioTransport({
        registry,
        serverName: SERVER_NAME,
        serverVersion: SERVER_VERSION,
        sessionId: stdioSessionId,
      })
    : null;

  let httpHandle: HttpTransportHandle | null = null;
  if (startHttp) {
    httpHandle = await startHttpTransport({ registry, serverName: SERVER_NAME, serverVersion: SERVER_VERSION, env });
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    bootLogger.info({ event: 'shutdown_signal', signal }, 'shutting down');

    // Drain in-flight setImmediate audit writes (S14 check_policy
    // dispatches policy_decisions inserts via setImmediate). One tick
    // gives them time to land before we close the DB.
    await new Promise<void>((resolve) => setImmediate(resolve));

    if (httpHandle) {
      try {
        await httpHandle.close();
      } catch (err) {
        bootLogger.error(
          { event: 'shutdown_error', subsystem: 'http', err: err instanceof Error ? err.message : String(err) },
          'http transport close threw',
        );
      }
    }
    if (stdioHandle) {
      try {
        await stdioHandle.close();
      } catch (err) {
        bootLogger.error(
          { event: 'shutdown_error', subsystem: 'stdio', err: err instanceof Error ? err.message : String(err) },
          'stdio transport close threw',
        );
      }
    }
    try {
      await dbClient.client.close();
    } catch (err) {
      bootLogger.error(
        { event: 'shutdown_error', subsystem: 'db', err: err instanceof Error ? err.message : String(err) },
        'db close threw',
      );
    }
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

/**
 * Parse the `--transport stdio|http|both` CLI flag (S16). Returns
 * `null` if the flag is absent (caller falls back to env). Throws on
 * an unrecognised value so a typo at boot fails loudly instead of
 * silently defaulting.
 */
function parseTransportFlag(argv: ReadonlyArray<string>): 'stdio' | 'http' | 'both' | null {
  const idx = argv.findIndex((a) => a === '--transport' || a === '-t');
  let value: string | undefined;
  if (idx >= 0 && idx + 1 < argv.length) {
    value = argv[idx + 1];
  } else {
    const inline = argv.find((a) => a.startsWith('--transport='));
    if (inline) value = inline.slice('--transport='.length);
  }
  if (value === undefined) return null;
  if (value === 'stdio' || value === 'http' || value === 'both') return value;
  throw new Error(`--transport: unrecognised value '${value}' (expected stdio | http | both)`);
}

main().catch((err: unknown) => {
  // Last-ditch error path. We cannot assume the shared logger has
  // wired up yet (it may have thrown on bad env), so write directly
  // to stderr and exit non-zero. Any handler-level error has already
  // been caught inside `registry.handleCall`; reaching here means
  // startup itself failed.
  const message = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
  process.stderr.write(`@contextos/mcp-server: fatal startup error\n${message}\n`);
  process.exit(1);
});
