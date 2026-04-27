import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInitCommand } from '../../src/commands/init.js';
import { FORBIDDEN_INIT_KEYS } from '../../src/lib/init/env-merge.js';

interface CapturedIO {
  stdout: string[];
  stderr: string[];
  exit: number | null;
}

function makeIO(): {
  io: { writeStdout(c: string): void; writeStderr(c: string): void; exit(code: number): never };
  captured: CapturedIO;
} {
  const captured: CapturedIO = { stdout: [], stderr: [], exit: null };
  const io = {
    writeStdout(c: string) {
      captured.stdout.push(c);
    },
    writeStderr(c: string) {
      captured.stderr.push(c);
    },
    exit(code: number): never {
      captured.exit = code;
      throw new Error(`__exit__:${code}`);
    },
  };
  return { io, captured };
}

describe('runInitCommand — integration', () => {
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'contextos-init-cwd-'));
    home = await mkdtemp(join(tmpdir(), 'contextos-init-home-'));
    // Need a marker so detectProjectRoot succeeds.
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'sample-app' }));
  });

  afterEach(() => {
    /* tmp cleaned by OS */
  });

  it('greenfield: writes data.db, .contextos.json, .mcp.json, .env, feature-pack', async () => {
    const { io, captured } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {} }, io)).rejects.toThrow('__exit__:0');
    expect(captured.exit).toBe(0);

    // ~/.contextos/ artifacts
    expect((await stat(join(home, 'data.db'))).isFile()).toBe(true);
    expect((await stat(join(home, 'logs'))).isDirectory()).toBe(true);
    expect((await stat(join(home, 'pids'))).isDirectory()).toBe(true);

    // Project artifacts
    const contextosJson = JSON.parse(await readFile(join(cwd, '.contextos.json'), 'utf8'));
    expect(contextosJson.projectSlug).toBeDefined();
    const mcpJson = JSON.parse(await readFile(join(cwd, '.mcp.json'), 'utf8'));
    expect(mcpJson.mcpServers.contextos).toBeDefined();

    const envBody = await readFile(join(cwd, '.env'), 'utf8');
    expect(envBody).toContain('CONTEXTOS_MODE=solo');
    expect(envBody).toContain('CLERK_SECRET_KEY=sk_test_replace_me');
    expect(envBody).toMatch(/LOCAL_HOOK_SECRET=[0-9a-f]{64}/);
    expect(envBody).toContain('MCP_SERVER_PORT=3100');

    // Feature pack seed
    const meta = JSON.parse(
      await readFile(join(cwd, 'docs/feature-packs', contextosJson.projectSlug, 'meta.json'), 'utf8'),
    );
    expect(meta.slug).toBe(contextosJson.projectSlug);
    expect(meta.parentSlug).toBeNull();
    expect(Array.isArray(meta.sourceFiles)).toBe(true);

    // Stdout includes the "ContextOS is ready" banner.
    const stdout = captured.stdout.join('');
    expect(stdout).toContain('ContextOS is ready');
  });

  it('idempotent re-run: no destructive writes (action: unchanged)', async () => {
    const { io: io1 } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {} }, io1)).rejects.toThrow('__exit__:0');

    // Snapshot the .env body before re-run.
    const before = await readFile(join(cwd, '.env'), 'utf8');

    const { io: io2, captured: captured2 } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {} }, io2)).rejects.toThrow('__exit__:0');
    expect(captured2.exit).toBe(0);

    const after = await readFile(join(cwd, '.env'), 'utf8');
    expect(after).toBe(before); // re-run preserves user values

    // Stdout shows the unchanged glyph + notes for at least one artifact.
    const stdout = captured2.stdout.join('');
    expect(stdout).toMatch(/already matches baseline|all baseline keys already present|projectSlug already/);
  });

  it('--force overwrites .contextos.json baseline (Decision 3)', async () => {
    const { io: io1 } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {}, projectSlug: 'first' }, io1)).rejects.toThrow('__exit__:0');
    expect(JSON.parse(await readFile(join(cwd, '.contextos.json'), 'utf8')).projectSlug).toBe('first');

    // Without --force, providing a different slug preserves the existing value.
    const { io: io2 } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {}, projectSlug: 'second' }, io2)).rejects.toThrow('__exit__:0');
    expect(JSON.parse(await readFile(join(cwd, '.contextos.json'), 'utf8')).projectSlug).toBe('first');

    // With --force, baseline overwrites.
    const { io: io3 } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {}, projectSlug: 'second', force: true }, io3)).rejects.toThrow(
      '__exit__:0',
    );
    expect(JSON.parse(await readFile(join(cwd, '.contextos.json'), 'utf8')).projectSlug).toBe('second');
  });

  it('preserves existing .mcp.json entries when adding contextos', async () => {
    await writeFile(
      join(cwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'npx', args: ['something-else'] } } }),
    );
    const { io } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {} }, io)).rejects.toThrow('__exit__:0');
    const merged = JSON.parse(await readFile(join(cwd, '.mcp.json'), 'utf8'));
    expect(merged.mcpServers.other).toEqual({ command: 'npx', args: ['something-else'] });
    expect(merged.mcpServers.contextos).toBeDefined();
  });

  it('--dry-run: prints outcomes but writes nothing', async () => {
    const { io, captured } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {}, dryRun: true }, io)).rejects.toThrow('__exit__:0');
    // No .contextos.json written
    await expect(stat(join(cwd, '.contextos.json'))).rejects.toThrow();
    // No data.db written
    await expect(stat(join(home, 'data.db'))).rejects.toThrow();
    expect(captured.stdout.join('')).toContain('--dry-run was set');
  });

  it('NO secrets-leaked invariant: written .env never contains forbidden production keys (spec §6)', async () => {
    const { io } = makeIO();
    await expect(runInitCommand({ cwd, home, env: {} }, io)).rejects.toThrow('__exit__:0');
    const envBody = await readFile(join(cwd, '.env'), 'utf8');
    for (const key of FORBIDDEN_INIT_KEYS) {
      // The key may appear nowhere; if it does appear, it must be absent or empty.
      const lineRe = new RegExp(`^${key}=(.*)$`, 'm');
      const match = lineRe.exec(envBody);
      if (match !== null) {
        expect(match[1]).toBe('');
      }
    }
  });

  it('fails with EXIT_USER_RECOVERABLE when no project root marker is found', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'contextos-init-no-root-'));
    const sub = join(isolated, 'a', 'b');
    await mkdir(sub, { recursive: true });
    const { io, captured } = makeIO();
    await expect(runInitCommand({ cwd: sub, home, env: {} }, io)).rejects.toThrow('__exit__:1');
    expect(captured.exit).toBe(1);
    expect(captured.stderr.join('')).toMatch(/no project root marker found/);
  });
});
