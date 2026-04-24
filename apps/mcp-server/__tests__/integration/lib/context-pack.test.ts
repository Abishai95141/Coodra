import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateSqlite, type SqliteHandle, sqliteSchema } from '@contextos/db';
import { EMBEDDING_DIM, ValidationError } from '@contextos/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ContextPackWriteResult, createContextPackStore } from '../../../src/lib/context-pack.js';
import { createDbClient } from '../../../src/lib/db.js';

/**
 * Integration test for `src/lib/context-pack.ts` (S7c).
 *
 * Exercises the DB-first write path + FS reconcilable view + idem-
 * potency per runId + embedding-dim validation against a real
 * `:memory:` SQLite handle with migrations applied (including the
 * vec0 virtual table for embedding inserts).
 *
 * ---------------------------------------------------------------------------
 * TEST-WRITER GUARD: always pass `contextPacksRoot=<tmpdir>` when you
 * construct `createContextPackStore` in a test. The default
 * (`process.cwd() + /docs/context-packs`) writes into the actual repo
 * tree from wherever vitest spawns — leaking test files into
 * `apps/mcp-server/docs/context-packs/` or the repo root. `mkdtempSync(
 * join(tmpdir(), 'cp-'))` is the idiom this harness uses; copy it.
 * ---------------------------------------------------------------------------
 */

interface Harness {
  readonly close: () => Promise<void>;
  readonly handle: SqliteHandle;
  readonly contextPacksRoot: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly runId: string;
}

async function openHarness(): Promise<Harness> {
  const { client, asInternalHandle } = createDbClient({
    mode: 'solo',
    // vec extension required — migration 0001 creates the vec0 virtual table.
    sqlite: { path: ':memory:', skipPragmas: true },
  });
  const handle = asInternalHandle();
  if (handle.kind !== 'sqlite') throw new Error('expected sqlite handle');
  migrateSqlite(handle.db);
  const contextPacksRoot = mkdtempSync(join(tmpdir(), 'cp-'));
  const projectId = 'proj_cp';
  const projectSlug = 'slug-cp';
  const runId = 'run_cp_primary';
  handle.raw
    .prepare(`INSERT INTO projects (id, slug, org_id, name) VALUES (?, ?, ?, ?)`)
    .run(projectId, projectSlug, 'org_test', 'cp harness');
  handle.raw
    .prepare(
      `INSERT INTO runs (id, project_id, session_id, agent_type, mode, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, projectId, 'sess_cp', 'claude_code', 'solo', 'in_progress');
  return {
    close: async () => {
      await client.close();
    },
    handle,
    contextPacksRoot,
    projectId,
    projectSlug,
    runId,
  };
}

function basePack(h: Harness, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: h.runId,
    projectId: h.projectId,
    title: 'Test Context Pack',
    content: '# Example\n\nbody line\n',
    ...overrides,
  };
}

describe('lib/context-pack — construction', () => {
  it('rejects missing options', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createContextPackStore(undefined as unknown as any)).toThrow(TypeError);
  });
  it('rejects missing db handle', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createContextPackStore({} as any)).toThrow(/db must be a DbHandle/);
  });
});

describe('lib/context-pack — write with Float32Array embedding', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('inserts a context_packs row, a context_packs_vec row, and writes the FS file', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const embedding = new Float32Array(EMBEDDING_DIM);
    embedding[0] = 0.1;
    embedding[1] = 0.2;
    const out = (await store.write(basePack(h), embedding)) as ContextPackWriteResult;
    expect(out.id).toMatch(/^cp_/);
    expect(out.runId).toBe(h.runId);
    expect(out.embeddingStored).toBe(true);
    expect(out.filePath).toBeTruthy();
    expect(existsSync(out.filePath as string)).toBe(true);

    const dbRow = await h.handle.db
      .select()
      .from(sqliteSchema.contextPacks)
      .where(eq(sqliteSchema.contextPacks.id, out.id))
      .limit(1);
    expect(dbRow[0]?.runId).toBe(h.runId);

    const vecRow = h.handle.raw
      .prepare('SELECT context_pack_id AS id FROM context_packs_vec WHERE context_pack_id = ?')
      .get(out.id) as { id: string } | undefined;
    expect(vecRow?.id).toBe(out.id);
  });

  it('rejects an embedding whose length is not EMBEDDING_DIM', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const embedding = new Float32Array(128); // wrong dim
    await expect(store.write(basePack(h), embedding)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('lib/context-pack — write with null embedding', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('inserts a row with no vec0 entry, still materialises FS file', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const out = (await store.write(basePack(h), null)) as ContextPackWriteResult;
    expect(out.embeddingStored).toBe(false);
    expect(existsSync(out.filePath as string)).toBe(true);

    const vecRow = h.handle.raw
      .prepare('SELECT context_pack_id AS id FROM context_packs_vec WHERE context_pack_id = ?')
      .get(out.id) as { id: string } | undefined;
    expect(vecRow).toBeUndefined();
  });
});

describe('lib/context-pack — idempotency per runId', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns the existing row metadata on a second write for the same runId', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const first = (await store.write(basePack(h), null)) as ContextPackWriteResult;
    const second = (await store.write(
      basePack(h, { title: 'Different title', content: 'different body' }),
      null,
    )) as ContextPackWriteResult;
    expect(second.id).toBe(first.id);
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });
});

describe('lib/context-pack — validation', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('rejects a missing runId with ValidationError', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const pack = { projectId: h.projectId, title: 't', content: 'c' };
    await expect(store.write(pack, null)).rejects.toBeInstanceOf(ValidationError);
  });
  it('rejects a missing title with ValidationError', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const pack = { runId: 'r', projectId: 'p', content: 'c' };
    await expect(store.write(pack, null)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('lib/context-pack — read + list', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('read(runId) returns the inserted row', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const written = (await store.write(basePack(h), null)) as ContextPackWriteResult;
    const row = await store.read(h.runId);
    expect((row as { id: string }).id).toBe(written.id);
  });

  it('list({ projectSlug }) resolves slug → projectId and filters', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    await store.write(basePack(h), null);
    const rows = await store.list({ projectSlug: h.projectSlug, limit: 10 });
    expect(rows.length).toBe(1);
  });

  it('list({ projectSlug }) returns [] when slug does not resolve', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    await store.write(basePack(h), null);
    const rows = await store.list({ projectSlug: 'nope', limit: 10 });
    expect(rows).toEqual([]);
  });
});

describe('lib/context-pack — FS file content matches DB content', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('writes the full content markdown to the docs/context-packs file', async () => {
    const store = createContextPackStore({ db: h.handle, contextPacksRoot: h.contextPacksRoot });
    const content = '# Hello\n\nBody paragraph.\n';
    const out = (await store.write(basePack(h, { content }), null)) as ContextPackWriteResult;
    const onDisk = readFileSync(out.filePath as string, 'utf8');
    expect(onDisk).toBe(content);
  });
});
