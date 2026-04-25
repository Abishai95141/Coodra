import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Verification finding §8.3 fix: CONTEXTOS_DB_OVERRIDE_MODE.
 *
 * Before this fix, running the binary with `CONTEXTOS_MODE=team` failed
 * at boot with `createDb: mode=team requires DATABASE_URL` — there was
 * no production-binary path to exercise team-mode auth chain locally
 * without spinning up Postgres.
 *
 * After the fix, setting `CONTEXTOS_DB_OVERRIDE_MODE=solo` decouples
 * the auth-mode decision (env CONTEXTOS_MODE) from the DB-dialect
 * decision (createDb routing). This test boots the binary with that
 * combination and asserts the server starts + tools/list works.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const SERVER_BIN = resolve(ROOT, 'apps/mcp-server/dist/index.js');

interface Harness {
  readonly client: Client;
  readonly dataDir: string;
}

let h: Harness;

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'team-sqlite-'));
  const sqlitePath = join(dataDir, 'fresh-data.db');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_BIN, '--transport', 'stdio'],
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      CONTEXTOS_MODE: 'team',
      CONTEXTOS_DB_OVERRIDE_MODE: 'solo',
      CLERK_SECRET_KEY: 'sk_test_replace_me',
      CONTEXTOS_LOG_DESTINATION: 'stderr',
      CONTEXTOS_SQLITE_PATH: sqlitePath,
    } as Record<string, string>,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'team-sqlite-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);

  h = { client, dataDir };
}, 60_000);

afterAll(async () => {
  if (h?.client) {
    await h.client.close().catch(() => {});
  }
  if (h?.dataDir) {
    rmSync(h.dataDir, { recursive: true, force: true });
  }
}, 30_000);

describe('boot — CONTEXTOS_DB_OVERRIDE_MODE=solo + CONTEXTOS_MODE=team (finding §8.3)', () => {
  it('binary boots with team-mode auth + sqlite store; tools/list returns 9 tools; tool reaches DB without error', async () => {
    const { tools } = await h.client.listTools();
    expect(tools.length).toBe(9);
    // Under CONTEXTOS_MODE=team, get_run_id does NOT auto-create projects
    // (per S8) — unknown slug → soft-failure project_not_found. That's
    // the contract; what we're verifying here is that:
    //   (a) the binary booted with sqlite (didn't fail at createDb).
    //   (b) the tool ran end-to-end against sqlite (transport ok:true).
    //   (c) the soft-failure envelope shape is canonical, proving the
    //       DB read path actually executed.
    const result = await h.client.callTool({ name: 'get_run_id', arguments: { projectSlug: 'override-test' } });
    const text = (result.content as ReadonlyArray<{ text: string }>)[0]?.text ?? '{}';
    const parsed = JSON.parse(text) as { ok: boolean; data?: { ok: boolean; error?: string; howToFix?: string } };
    expect(parsed.ok).toBe(true); // transport ok
    expect(parsed.data?.ok).toBe(false); // domain soft-failure under team mode
    expect(parsed.data?.error).toBe('project_not_found');
    expect(parsed.data?.howToFix).toBeTruthy();
  });
});
