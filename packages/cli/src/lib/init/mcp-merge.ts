import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WriteOutcome } from './types.js';

export interface BuildMcpEntryOptions {
  /** Absolute path to the contextos-mcp-server binary on disk, when known. */
  readonly mcpServerBin: string | null;
  /** Solo-mode bypass token to set on the MCP entry. Always solo-only. */
  readonly clerkSecretKey: string;
}

export interface ContextosMcpEntry {
  readonly command: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
}

/**
 * Build the canonical `contextos` entry for `.mcp.json`. When the
 * `contextos-mcp-server` binary is on disk (dev monorepo case), the entry
 * points at it directly. Otherwise the entry uses `npx @contextos/cli mcp-stdio`
 * — the path resolves at IDE-startup time, sidestepping the npx-cache-GC
 * footgun named in techstack.md Gotchas.
 */
export function buildContextosMcpEntry(options: BuildMcpEntryOptions): ContextosMcpEntry {
  if (options.mcpServerBin !== null) {
    return {
      command: 'node',
      args: [options.mcpServerBin, '--transport', 'stdio'],
      env: { CONTEXTOS_LOG_DESTINATION: 'stderr', CLERK_SECRET_KEY: options.clerkSecretKey },
    };
  }
  return {
    command: 'npx',
    args: ['-y', '@contextos/cli', 'mcp-stdio'],
    env: { CONTEXTOS_LOG_DESTINATION: 'stderr', CLERK_SECRET_KEY: options.clerkSecretKey },
  };
}

/** True when both entries are byte-for-byte equal under JSON canonicalisation. */
export function isContextosEntryEqual(a: ContextosMcpEntry, b: unknown): boolean {
  if (typeof b !== 'object' || b === null) return false;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export interface MergeMcpJsonOptions {
  readonly cwd: string;
  readonly entry: ContextosMcpEntry;
  readonly force: boolean;
  readonly dryRun: boolean;
}

/**
 * Idempotent merge of the `contextos` entry into `<cwd>/.mcp.json` per
 * spec §11 Decision 3. Returns the WriteOutcome describing what happened.
 */
export async function mergeMcpJson(options: MergeMcpJsonOptions): Promise<WriteOutcome> {
  const path = join(options.cwd, '.mcp.json');
  const exists = await pathExists(path);

  if (!exists) {
    const baseline = { mcpServers: { contextos: options.entry } };
    if (!options.dryRun) await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    return { path, action: 'wrote', notes: 'created baseline .mcp.json with contextos entry' };
  }

  const raw = await readFile(path, 'utf8');
  let parsed: { mcpServers?: Record<string, unknown>; [k: string]: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cannot parse existing .mcp.json: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`.mcp.json must be a JSON object`);
  }

  const servers = (parsed.mcpServers as Record<string, unknown> | undefined) ?? {};
  const existingContextos = servers.contextos;

  if (options.force) {
    parsed.mcpServers = { ...servers, contextos: options.entry };
    if (!options.dryRun) await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return { path, action: 'forced', notes: 'overwrote .mcp.json with baseline contextos entry' };
  }

  if (existingContextos === undefined) {
    parsed.mcpServers = { ...servers, contextos: options.entry };
    if (!options.dryRun) await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return { path, action: 'merged', notes: 'added contextos entry to existing .mcp.json' };
  }

  if (isContextosEntryEqual(options.entry, existingContextos)) {
    return { path, action: 'unchanged', notes: 'contextos entry already matches baseline' };
  }

  // Drift: existing contextos entry differs from baseline. Without `--force`
  // we preserve the user's edits (Decision 3 — "never destroys user edits").
  return {
    path,
    action: 'unchanged',
    notes: 'contextos entry exists with custom config; pass --force to overwrite with baseline',
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
