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
import { devNullPolicyCheck, logDevNullPolicyInUse } from './framework/policy-wrapper.js';
import { ToolRegistry } from './framework/tool-registry.js';
import { pingToolRegistration } from './tools/ping/manifest.js';
import { startStdioTransport } from './transports/stdio.js';

const bootLogger = createLogger('mcp-server.boot');

const SERVER_NAME = '@contextos/mcp-server' as const;
const SERVER_VERSION = '0.0.0' as const;

/**
 * Process entrypoint for `@contextos/mcp-server`.
 *
 * S5 scope (walking skeleton):
 *   - stdio transport only (HTTP deferred to S16).
 *   - `ping` tool only (S6–S15 ship the eight real tools).
 *   - Always-allow `devNullPolicyCheck` wrapping every call (real
 *     policy engine lands in S7b as a single-file swap at the call
 *     site below).
 *
 * Layout invariants locked by this file:
 *   1. `./bootstrap/ensure-stderr-logging.js` is the first import.
 *   2. `env` is read from `./config/env.js` — the one module allowed
 *      to touch `process.env`.
 *   3. The `ToolRegistry` is constructed once, with the injected
 *      `PolicyCheck` as its single constructor arg. Handlers cannot
 *      opt out because they never see an unwrapped call path.
 *   4. Graceful shutdown on SIGINT/SIGTERM — close the transport,
 *      flush pino (stderr), exit 0.
 */
async function main(): Promise<void> {
  // `env` is parsed at module load; touching it here just confirms
  // it was imported and surfaces parse errors in the main boot log.
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

  const registry = new ToolRegistry(devNullPolicyCheck);
  logDevNullPolicyInUse();

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
