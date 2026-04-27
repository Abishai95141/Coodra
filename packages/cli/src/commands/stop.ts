import pc from 'picocolors';
import { EXIT_OK } from '../exit-codes.js';
import { resolveContextosHome } from '../lib/contextos-home.js';
import { selectDaemonManager } from '../lib/daemon/index.js';
import { SERVICES, type ServiceName } from '../lib/services.js';

export interface StopOptions {
  readonly service?: string;
  readonly uninstall?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
}

export interface StopIO {
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
  readonly exit: (code: number) => never;
}

export const DEFAULT_STOP_IO: StopIO = {
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

export async function runStopCommand(options: StopOptions = {}, io: StopIO = DEFAULT_STOP_IO): Promise<never> {
  const env = options.env ?? process.env;
  const contextosHome = resolveContextosHome({
    ...(options.home !== undefined ? { override: options.home } : {}),
    env,
  });
  const manager = await selectDaemonManager({ contextosHome });

  const target = options.service;
  const candidates =
    target === undefined ? SERVICES.map((s) => s.name) : SERVICES.map((s) => s.name).filter((n) => n === target);
  if (candidates.length === 0) {
    io.writeStderr(`${pc.red('contextos stop')}: unknown service '${target}'.\n`);
    return io.exit(EXIT_OK); // stop is idempotent — unknown service is a no-op
  }

  for (const name of candidates as ServiceName[]) {
    try {
      await manager.stop(name);
      if (options.uninstall === true) {
        await manager.uninstall(name);
      }
      io.writeStdout(`${pc.green('✓')} Stopped ${name}\n`);
    } catch (err) {
      io.writeStderr(`${pc.yellow('⚠')} ${name} stop reported: ${(err as Error).message}\n`);
    }
  }
  return io.exit(EXIT_OK);
}
