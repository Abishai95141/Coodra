import { resolve } from 'node:path';
import { resolveContextosDataDb, resolveContextosHome } from '../lib/contextos-home.js';
import type { CheckContext } from './types.js';

export interface BuildCheckContextOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly contextosHomeOverride?: string;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly platform?: NodeJS.Platform;
  readonly nodeVersion?: string;
}

export function buildCheckContext(options: BuildCheckContextOptions = {}): CheckContext {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const contextosHome = resolveContextosHome({
    ...(options.contextosHomeOverride !== undefined ? { override: options.contextosHomeOverride } : {}),
    env,
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
  });
  const dataDb = resolveContextosDataDb(contextosHome);
  const mcpPort = parsePortFromEnv(env.MCP_SERVER_PORT, 3100);
  const bridgePort = parsePortFromEnv(env.HOOKS_BRIDGE_PORT, 3101);

  return {
    contextosHome,
    dataDb,
    cwd,
    env,
    mcpPort,
    bridgePort,
    now: options.now ?? (() => new Date()),
    timeoutMs: options.timeoutMs ?? 2000,
    platform: options.platform ?? process.platform,
    nodeVersion: options.nodeVersion ?? process.versions.node,
  };
}

function parsePortFromEnv(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}
