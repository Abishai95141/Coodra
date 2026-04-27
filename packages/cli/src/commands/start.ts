import pc from 'picocolors';
import { EXIT_OK, EXIT_SERVICE_STARTUP_FAILED, EXIT_USER_RECOVERABLE } from '../exit-codes.js';
import { resolveContextosHome } from '../lib/contextos-home.js';
import { selectDaemonManager } from '../lib/daemon/index.js';
import { type ResolvedService, resolveServices } from '../lib/services.js';
import { waitForHealth } from '../lib/wait-for-health.js';

export interface StartOptions {
  readonly mcp?: boolean;
  readonly hooks?: boolean;
  readonly foreground?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly waitTimeoutMs?: number;
}

export interface StartIO {
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
  readonly exit: (code: number) => never;
}

export const DEFAULT_START_IO: StartIO = {
  writeStdout: (chunk) => {
    process.stdout.write(chunk);
  },
  writeStderr: (chunk) => {
    process.stderr.write(chunk);
  },
  exit: (code) => {
    process.exit(code);
  },
};

export async function runStartCommand(options: StartOptions = {}, io: StartIO = DEFAULT_START_IO): Promise<never> {
  const env = options.env ?? process.env;

  if (options.foreground === true) {
    io.writeStderr(
      `${pc.yellow('contextos start --foreground')}: not implemented in 08a — for foreground debug use ` +
        '`pnpm --filter @contextos/{mcp-server,hooks-bridge} dev` directly per docs/DEVELOPMENT.md.\n',
    );
    return io.exit(EXIT_USER_RECOVERABLE);
  }

  const contextosHome = resolveContextosHome({
    ...(options.home !== undefined ? { override: options.home } : {}),
    env,
  });

  let resolved: ResolvedService[];
  try {
    resolved = await resolveServices({ contextosHome, env });
  } catch (err) {
    io.writeStderr(`${pc.red('contextos start')}: ${(err as Error).message}\n`);
    return io.exit(EXIT_USER_RECOVERABLE);
  }

  const skip = (name: string): boolean =>
    (name === 'mcp-server' && options.mcp === false) || (name === 'hooks-bridge' && options.hooks === false);

  const manager = await selectDaemonManager({ contextosHome });
  io.writeStdout(`${pc.gray(`Using ${manager.kind} daemon manager.`)}\n`);

  let anyFailure = false;

  for (const service of resolved) {
    if (skip(service.descriptor.name)) {
      io.writeStdout(`${pc.gray('·')} Skipping ${service.descriptor.displayName} (--no-${service.descriptor.name}).\n`);
      continue;
    }
    try {
      await manager.install(service.unit);
      await manager.start(service.descriptor.name);
    } catch (err) {
      io.writeStderr(`${pc.red('✗')} Failed to start ${service.descriptor.displayName}: ${(err as Error).message}\n`);
      anyFailure = true;
      continue;
    }
    const healthy = await waitForHealth({
      url: service.descriptor.healthUrl(service.port),
      timeoutMs: options.waitTimeoutMs ?? 10_000,
    });
    if (healthy) {
      io.writeStdout(`${pc.green('✓')} ${service.descriptor.displayName} listening on :${service.port}\n`);
    } else {
      io.writeStderr(
        `${pc.red('✗')} ${service.descriptor.displayName} did not become healthy on :${service.port} within ${options.waitTimeoutMs ?? 10_000}ms\n`,
      );
      anyFailure = true;
    }
  }

  if (anyFailure) {
    io.writeStderr(`${pc.red('Start failed.')} Run \`contextos doctor\` for diagnostics.\n`);
    return io.exit(EXIT_SERVICE_STARTUP_FAILED);
  }
  io.writeStdout(`${pc.green('All ContextOS services running.')}\n`);
  return io.exit(EXIT_OK);
}
