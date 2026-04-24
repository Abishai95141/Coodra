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
import { pingToolRegistration } from './tools/ping/manifest.js';
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
  const dbClient = createDbClient({});
  const dbHandle = dbClient.asInternalHandle();
  const auth = createAuthClient(env);
  const policy = createPolicyClient({ db: dbHandle });
  const featurePack = createFeaturePackStore({ db: dbHandle });
  const contextPack = createContextPackStore({ db: dbHandle });
  const runRecorder = createRunRecorder({ db: dbHandle });
  const sqliteVec = createSqliteVecClient({ db: dbHandle });
  const graphify = createGraphifyClient({ db: dbHandle });

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
  registry.register(pingToolRegistration);

  const sessionId = `stdio:${randomUUID()}`;
  const transport = await startStdioTransport({
    registry,
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    sessionId,
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    bootLogger.info({ event: 'shutdown_signal', signal }, 'shutting down');
    try {
      await transport.close();
    } catch (err) {
      bootLogger.error(
        { event: 'shutdown_error', err: err instanceof Error ? err.message : String(err) },
        'transport close threw',
      );
    }
    try {
      await dbClient.client.close();
    } catch (err) {
      bootLogger.error(
        { event: 'shutdown_error', err: err instanceof Error ? err.message : String(err) },
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
