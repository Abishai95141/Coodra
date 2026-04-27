import { join, resolve } from 'node:path';
import { resolveContextosLogsDir } from './contextos-home.js';
import type { DaemonUnit } from './daemon/index.js';
import { findRepoRoot } from './find-repo-root.js';

export type ServiceName = 'mcp-server' | 'hooks-bridge';

export interface ServiceDescriptor {
  readonly name: ServiceName;
  readonly displayName: string;
  /** Port the service binds to. */
  readonly port: number;
  /** Path under each service binary's repo root, relative to repoRoot. */
  readonly relativeEntry: string;
  /** Health-check URL (uses port). */
  readonly healthUrl: (port: number) => string;
  /** Default port. */
  readonly defaultPort: number;
}

export const SERVICES: readonly ServiceDescriptor[] = [
  {
    name: 'mcp-server',
    displayName: 'ContextOS MCP Server',
    port: 3100,
    defaultPort: 3100,
    relativeEntry: 'apps/mcp-server/dist/index.js',
    healthUrl: (port) => `http://127.0.0.1:${port}/healthz`,
  },
  {
    name: 'hooks-bridge',
    displayName: 'ContextOS Hooks Bridge',
    port: 3101,
    defaultPort: 3101,
    relativeEntry: 'apps/hooks-bridge/dist/index.js',
    healthUrl: (port) => `http://127.0.0.1:${port}/healthz`,
  },
];

export interface BuildServiceUnitOptions {
  readonly contextosHome: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface ResolvedService {
  readonly descriptor: ServiceDescriptor;
  readonly entryPath: string;
  readonly port: number;
  readonly unit: DaemonUnit;
}

/**
 * Build the DaemonUnit each service runs as, given a resolved repo root
 * and the user's env. When the repo root cannot be located (e.g. CLI
 * installed via `npm i -g` outside the monorepo), this throws so `start`
 * surfaces the failure with a readable error.
 */
export async function resolveServices(options: BuildServiceUnitOptions): Promise<ResolvedService[]> {
  const repoRoot = await findRepoRoot(process.cwd());
  if (repoRoot === null) {
    throw new Error(
      'Cannot locate the ContextOS repo root from the current directory. ' +
        'In 08a `start`/`stop` only work from within the dev monorepo; ' +
        '`npm i -g @contextos/cli` deployment is tracked as a follow-up.',
    );
  }
  const env = options.env;
  const mcpPort = parsePort(env.MCP_SERVER_PORT, 3100);
  const bridgePort = parsePort(env.HOOKS_BRIDGE_PORT, 3101);

  const logsDir = resolveContextosLogsDir(options.contextosHome);
  return SERVICES.map((descriptor) => {
    const port = descriptor.name === 'mcp-server' ? mcpPort : bridgePort;
    const entryPath = resolve(repoRoot, descriptor.relativeEntry);
    const unitEnv = buildServiceEnv({ env, contextosHome: options.contextosHome, port, name: descriptor.name });
    // pino → stderr per CONTEXTOS_LOG_DESTINATION; both streams routed into
    // <contextos-home>/logs/<name>.log so doctor check 8 can read them and
    // field debugging is possible (vs the pre-fix /dev/null sink).
    const stdoutPath = join(logsDir, `${descriptor.name}.log`);
    const stderrPath = join(logsDir, `${descriptor.name}.log`);
    const unit: DaemonUnit = {
      name: descriptor.name,
      command: process.execPath,
      args: [entryPath],
      env: unitEnv,
      workingDir: repoRoot,
      stdoutPath,
      stderrPath,
    };
    return { descriptor, entryPath, port, unit };
  });
}

function buildServiceEnv(args: {
  readonly env: NodeJS.ProcessEnv;
  readonly contextosHome: string;
  readonly port: number;
  readonly name: ServiceName;
}): Record<string, string> {
  const env: Record<string, string> = {
    CONTEXTOS_LOG_DESTINATION: 'stderr',
    CONTEXTOS_HOME: args.contextosHome,
  };
  // Carry through the secrets-bearing env vars the service expects, never
  // logging them at the CLI layer.
  for (const key of [
    'CONTEXTOS_MODE',
    'CLERK_SECRET_KEY',
    'CLERK_PUBLISHABLE_KEY',
    'LOCAL_HOOK_SECRET',
    'DATABASE_URL',
  ]) {
    const value = args.env[key];
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value;
    }
  }
  if (args.name === 'mcp-server') {
    env.MCP_SERVER_PORT = String(args.port);
    env.MCP_SERVER_TRANSPORT = 'http';
    env.MCP_SERVER_HOST = '127.0.0.1';
  } else {
    env.HOOKS_BRIDGE_PORT = String(args.port);
    env.HOOKS_BRIDGE_HOST = '127.0.0.1';
  }
  return env;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return fallback;
  return parsed;
}
