import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateSqlite, type SqliteHandle } from '@contextos/db';
import { EMBEDDING_DIM, ValidationError } from '@contextos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContextPackStore } from '../../../src/lib/context-pack.js';
import { createDbClient } from '../../../src/lib/db.js';
import { createSqliteVecClient } from '../../../src/lib/sqlite-vec.js';

/**
 * Integration test for `src/lib/sqlite-vec.ts` (S7c, sqlite path).
 *
 * Seeds `context_packs` + `context_packs_vec` via the real
 * `context-pack.write` path (so the embedding insert goes through
 * the documented vec0 code path), then exercises
 * `searchSimilarPacks` with realistic KNN queries.
 *
 * ---------------------------------------------------------------------------
 * TEST-WRITER GUARD: always pass `contextPacksRoot=<tmpdir>` when you
 * construct `createContextPackStore` in a test. The default
 * (`process.cwd() + /docs/context-packs`) writes into the actual repo
 * tree from wherever vitest spawns — leaking test files into
 * `apps/mcp-server/docs/context-packs/` or the repo root. `mkdtempSync(
 * join(tmpdir(), 'svec-cp-'))` is the idiom this file uses; copy it.
 * ---------------------------------------------------------------------------
 *
 * The postgres / pgvector branch is covered by read-through in
 * `policy-db.test.ts`-style future additions that run under
 * testcontainers. S7c sqlite coverage is sufficient to lock the
 * domain contract.
 */

interface Harness {
  readonly close: () => Promise<void>;
  readonly handle: SqliteHandle;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly runIds: ReadonlyArray<string>;
}

function makeUnitVector(index: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[index] = 1;
  return v;
}

async function openHarness(): Promise<Harness> {
  const { client, asInternalHandle } = createDbClient({
    mode: 'solo',
    sqlite: { path: ':memory:', skipPragmas: true },
  });
  const handle = asInternalHandle();
  if (handle.kind !== 'sqlite') throw new Error('expected sqlite handle');
  migrateSqlite(handle.db);
  const projectId = `proj_${randomUUID()}`;
  const projectSlug = `slug-${projectId.slice(5, 13)}`;
  handle.raw
    .prepare(`INSERT INTO projects (id, slug, org_id, name) VALUES (?, ?, ?, ?)`)
    .run(projectId, projectSlug, 'org_test', 'sqlite-vec harness');
  // Seed 3 runs + 3 context packs with distinct unit-vector embeddings.
  // Pass a tmpdir so the FS materialisation doesn't leak into the repo.
  const contextPacksRoot = mkdtempSync(join(tmpdir(), 'svec-cp-'));
  const store = createContextPackStore({ db: handle, contextPacksRoot });
  const runIds: string[] = [];
  for (const [idx, axis] of [
    ['1', 0],
    ['2', 10],
    ['3', 20],
  ] as const) {
    const runId = `run_vec_${idx}`;
    runIds.push(runId);
    handle.raw
      .prepare(
        `INSERT INTO runs (id, project_id, session_id, agent_type, mode, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, projectId, `sess_vec_${idx}`, 'claude_code', 'solo', 'in_progress');
    await store.write({ runId, projectId, title: `Pack ${idx}`, content: `body ${idx}` }, makeUnitVector(axis));
  }
  return {
    close: async () => {
      await client.close();
    },
    handle,
    projectId,
    projectSlug,
    runIds,
  };
}

describe('lib/sqlite-vec — construction', () => {
  it('rejects missing options', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createSqliteVecClient(undefined as unknown as any)).toThrow(TypeError);
  });
  it('rejects missing db handle', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createSqliteVecClient({} as any)).toThrow(/db must be a DbHandle/);
  });
});

describe('lib/sqlite-vec — domain surface stays narrow', () => {
  it('exposes only searchSimilarPacks — no raw SQL runner', async () => {
    const h = await openHarness();
    try {
      const client = createSqliteVecClient({ db: h.handle }) as unknown as Record<string, unknown>;
      expect(typeof client.searchSimilarPacks).toBe('function');
      expect(client.run).toBeUndefined();
      expect(client.query).toBeUndefined();
      expect(client.exec).toBeUndefined();
      expect(client.prepare).toBeUndefined();
    } finally {
      await h.close();
    }
  });
});

describe('lib/sqlite-vec — input validation', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('rejects a non-Float32Array embedding', async () => {
    const client = createSqliteVecClient({ db: h.handle });
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: negative test
      client.searchSimilarPacks({ embedding: new Uint8Array(384) as any, k: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an embedding whose length is not EMBEDDING_DIM', async () => {
    const client = createSqliteVecClient({ db: h.handle });
    await expect(client.searchSimilarPacks({ embedding: new Float32Array(128), k: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects non-positive k', async () => {
    const client = createSqliteVecClient({ db: h.handle });
    await expect(
      client.searchSimilarPacks({ embedding: new Float32Array(EMBEDDING_DIM), k: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('lib/sqlite-vec — KNN ordering', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns the closest pack first when querying near axis 0', async () => {
    const client = createSqliteVecClient({ db: h.handle });
    const hits = await client.searchSimilarPacks({
      embedding: makeUnitVector(0),
      k: 3,
    });
    expect(hits.length).toBe(3);
    // The pack with unit-vector on axis 0 should be first (distance 0),
    // the others sit at cosine distance 1 (orthogonal) and should follow.
    expect(hits[0]?.distance).toBeLessThan(hits[1]?.distance ?? Number.POSITIVE_INFINITY);
  });

  it('respects k as the result-count cap', async () => {
    const client = createSqliteVecClient({ db: h.handle });
    const hits = await client.searchSimilarPacks({
      embedding: makeUnitVector(0),
      k: 1,
    });
    expect(hits.length).toBe(1);
  });

  it('scopes to a project when filter.projectSlug is set, [] for unknown slug', async () => {
    const client = createSqliteVecClient({ db: h.handle });
    const scoped = await client.searchSimilarPacks({
      embedding: makeUnitVector(0),
      k: 10,
      filter: { projectSlug: h.projectSlug },
    });
    expect(scoped.length).toBe(3);
    const noScope = await client.searchSimilarPacks({
      embedding: makeUnitVector(0),
      k: 10,
      filter: { projectSlug: 'nonexistent-slug' },
    });
    expect(noScope).toEqual([]);
  });
});
