import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeCursorMcpConfig, removeCursorMcpConfig } from '../../../src/lib/init/cursor-merge.js';
import type { CoodraMcpEntry } from '../../../src/lib/init/mcp-merge.js';

/**
 * Locks the 0.2.0-beta.1 Cursor MCP-config writer contract — mirrors
 * the `codex-merge` and `windsurf-merge` tests:
 *   1. Greenfield — absent .cursor/mcp.json → created with the
 *      mcpServers.coodra entry.
 *   2. Idempotent — second merge with the same entry is 'unchanged'.
 *   3. Merge-don't-clobber — pre-existing server entries survive.
 *   4. Drift preserved without --force; overwritten with --force.
 *   5. Dry-run writes nothing.
 *   6. removeCursorMcpConfig strips only the coodra entry.
 */

const ENTRY: CoodraMcpEntry = {
  command: 'node',
  args: ['/abs/path/runtime/mcp-server/index.js', '--transport', 'stdio'],
  env: { COODRA_LOG_DESTINATION: 'stderr', CLERK_SECRET_KEY: 'sk_test_x' },
};

interface CursorConfig {
  mcpServers?: Record<string, unknown>;
}

async function readJson(path: string): Promise<CursorConfig> {
  return JSON.parse(await readFile(path, 'utf8')) as CursorConfig;
}

describe('mergeCursorMcpConfig — Cursor .cursor/mcp.json writer', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'coodra-cursor-merge-'));
  });
  afterEach(() => {
    /* tmp cleaned by OS */
  });

  it('greenfield: creates .cursor/mcp.json with the coodra MCP entry', async () => {
    const result = await mergeCursorMcpConfig({ cwd, entry: ENTRY, force: false, dryRun: false });
    expect(result.action).toBe('wrote');
    const parsed = await readJson(join(cwd, '.cursor', 'mcp.json'));
    expect(parsed.mcpServers?.coodra).toEqual(ENTRY);
  });

  it('is idempotent — a second identical merge is unchanged', async () => {
    await mergeCursorMcpConfig({ cwd, entry: ENTRY, force: false, dryRun: false });
    const second = await mergeCursorMcpConfig({ cwd, entry: ENTRY, force: false, dryRun: false });
    expect(second.action).toBe('unchanged');
  });

  it("merge-don't-clobber: preserves other MCP server entries", async () => {
    await mkdir(join(cwd, '.cursor'), { recursive: true });
    await writeFile(
      join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { othersrv: { command: 'other-bin' } } }, null, 2),
      'utf8',
    );
    const result = await mergeCursorMcpConfig({ cwd, entry: ENTRY, force: false, dryRun: false });
    expect(result.action).toBe('merged');
    const parsed = await readJson(join(cwd, '.cursor', 'mcp.json'));
    expect(parsed.mcpServers?.coodra).toEqual(ENTRY);
    expect(parsed.mcpServers?.othersrv).toEqual({ command: 'other-bin' });
  });

  it('drift: preserves a divergent coodra entry without --force', async () => {
    await mkdir(join(cwd, '.cursor'), { recursive: true });
    const drifted = { command: 'node', args: ['/some/other/path'], env: { CUSTOM: '1' } };
    await writeFile(
      join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { coodra: drifted } }, null, 2),
      'utf8',
    );
    const result = await mergeCursorMcpConfig({ cwd, entry: ENTRY, force: false, dryRun: false });
    expect(result.action).toBe('unchanged');
    const parsed = await readJson(join(cwd, '.cursor', 'mcp.json'));
    expect(parsed.mcpServers?.coodra).toEqual(drifted);
  });

  it('--force overwrites a drifted coodra entry', async () => {
    await mkdir(join(cwd, '.cursor'), { recursive: true });
    await writeFile(
      join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { coodra: { command: 'other' } } }, null, 2),
      'utf8',
    );
    const result = await mergeCursorMcpConfig({ cwd, entry: ENTRY, force: true, dryRun: false });
    expect(result.action).toBe('forced');
    const parsed = await readJson(join(cwd, '.cursor', 'mcp.json'));
    expect(parsed.mcpServers?.coodra).toEqual(ENTRY);
  });

  it('dry-run writes nothing', async () => {
    const result = await mergeCursorMcpConfig({ cwd, entry: ENTRY, force: false, dryRun: true });
    expect(result.action).toBe('wrote');
    await expect(readFile(join(cwd, '.cursor', 'mcp.json'), 'utf8')).rejects.toThrow();
  });
});

describe('removeCursorMcpConfig', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'coodra-cursor-remove-'));
  });

  it("is a no-op when .cursor/mcp.json doesn't exist", async () => {
    const result = await removeCursorMcpConfig({ cwd, dryRun: false });
    expect(result.action).toBe('unchanged');
  });

  it('strips only the coodra entry, leaving others intact', async () => {
    await mkdir(join(cwd, '.cursor'), { recursive: true });
    await writeFile(
      join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            coodra: { command: 'node', args: ['x'] },
            othersrv: { command: 'other' },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    const result = await removeCursorMcpConfig({ cwd, dryRun: false });
    expect(result.action).toBe('merged');
    const parsed = await readJson(join(cwd, '.cursor', 'mcp.json'));
    expect(parsed.mcpServers?.coodra).toBeUndefined();
    expect(parsed.mcpServers?.othersrv).toEqual({ command: 'other' });
  });

  it('is idempotent — re-removing a missing entry is unchanged', async () => {
    await mkdir(join(cwd, '.cursor'), { recursive: true });
    await writeFile(
      join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { othersrv: { command: 'other' } } }, null, 2),
      'utf8',
    );
    const result = await removeCursorMcpConfig({ cwd, dryRun: false });
    expect(result.action).toBe('unchanged');
  });
});
