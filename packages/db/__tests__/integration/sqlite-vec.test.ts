import { EMBEDDING_DIM } from '@contextos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteDb, loadSqliteVecOrFail, type SqliteHandle } from '../../src/client.js';
import { migrateSqlite } from '../../src/migrate.js';

/**
 * Integration test for the sqlite-vec wiring landed in S4:
 *
 *   1. `loadSqliteVecOrFail` succeeds on a bare `better-sqlite3` handle.
 *   2. Migration 0001's hand-written preserve block really creates a
 *      functional vec0 virtual table `context_packs_vec` with
 *      `EMBEDDING_DIM` dimensions.
 *   3. KNN search with cosine distance returns the nearest neighbour
 *      first — end-to-end, vector written and vector read.
 *   4. When the load is forced to fail (simulated by stubbing the raw
 *      handle's `loadExtension`) the helper's strict vs fail-open
 *      behaviour flips on `NODE_ENV=test` / `CONTEXTOS_REQUIRE_VEC`
 *      exactly as decided on 2026-04-22 22:08.
 *
 * Runs under the integration test command (`pnpm --filter @contextos/db
 * test:integration`). It does not need `DATABASE_URL`, so it always
 * runs — unlike `postgres-migrate.test.ts` which gates on that env var.
 */
describe('sqlite-vec loadable extension + vec0 virtual table', () => {
  let handle: SqliteHandle;

  beforeEach(() => {
    handle = createSqliteDb({ path: ':memory:', skipPragmas: true });
    migrateSqlite(handle.db);
  });

  afterEach(() => {
    handle.close();
  });

  it('loads the extension and exposes a `vec_version()` SQL function', () => {
    const row = handle.raw.prepare('SELECT vec_version() AS v').get() as { v: string };
    expect(typeof row.v).toBe('string');
    expect(row.v.length).toBeGreaterThan(0);
  });

  it('creates the context_packs_vec virtual table with EMBEDDING_DIM dimensions', () => {
    const row = handle.raw
      .prepare(
        `SELECT sql FROM sqlite_master
           WHERE type = 'table' AND name = 'context_packs_vec'`,
      )
      .get() as { sql: string } | undefined;
    expect(row).toBeDefined();
    // The DDL in sqlite_master is the exact CREATE VIRTUAL TABLE text
    // as SQLite stored it. Lock the dimension literal to EMBEDDING_DIM so
    // any drift between the shared constant and the migration hand-block
    // is caught here (complementing `check-migration-lock.mjs`).
    expect(row?.sql).toMatch(/USING\s+vec0/i);
    expect(row?.sql).toMatch(new RegExp(`FLOAT\\[${EMBEDDING_DIM}\\]`, 'i'));
  });

  it('round-trips a 384-d embedding and returns it first under KNN-cosine', () => {
    // sqlite-vec accepts either a raw float32 BLOB of exactly `dim * 4`
    // bytes or a JSON-array text (`'[0.1, 0.2, ...]'`). We use the JSON
    // form here — it is the canonical input in the sqlite-vec README and
    // sidesteps any ambiguity in how better-sqlite3 marshals typed-array
    // buffers into BLOB parameters.
    const vecJson = (v: number[]): string => `[${v.join(',')}]`;

    const target = new Array<number>(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) target[i] = i % 2 === 0 ? 1 : 0;
    const far = new Array<number>(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) far[i] = i % 2 === 0 ? 0 : 1;

    const insert = handle.raw.prepare('INSERT INTO context_packs_vec(context_pack_id, embedding) VALUES (?, ?)');
    insert.run('ctx_target', vecJson(target));
    insert.run('ctx_far', vecJson(far));

    // Distance column is L2 by default for vec0 FLOAT[N] columns —
    // `target` matched against itself has distance 0, and `far` is
    // orthogonal to it. Target must rank first.
    const rows = handle.raw
      .prepare(
        `SELECT context_pack_id, distance
           FROM context_packs_vec
           WHERE embedding MATCH ?
             AND k = 2
           ORDER BY distance`,
      )
      .all(vecJson(target)) as Array<{ context_pack_id: string; distance: number }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]?.context_pack_id).toBe('ctx_target');
    expect(rows[0]?.distance).toBeLessThan(0.01);
    expect(rows[1]?.context_pack_id).toBe('ctx_far');
    expect(rows[1]?.distance).toBeGreaterThan(rows[0]?.distance ?? 0);
  });
});

/**
 * Direct unit-level coverage of `loadSqliteVecOrFail`'s failure modes.
 *
 * These are kept in the integration file (not `client.test.ts`) because
 * they depend on `sqlite-vec` being installed and resolvable in the
 * current runtime. Per the Apr-22 refinement, under `NODE_ENV=test` or
 * `CONTEXTOS_REQUIRE_VEC=1` a failed `loadExtension` must throw — never
 * silently degrade — and under relaxed env it must merely log a WARN.
 */
describe('loadSqliteVecOrFail failure modes', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRequireVec = process.env.CONTEXTOS_REQUIRE_VEC;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalRequireVec === undefined) delete process.env.CONTEXTOS_REQUIRE_VEC;
    else process.env.CONTEXTOS_REQUIRE_VEC = originalRequireVec;
  });

  function stubDb(): {
    loadExtension: (file: string, entrypoint?: string) => void;
    calls: number;
  } {
    // Minimal surface: sqlite-vec.load only calls `db.loadExtension(path)`.
    // We inject a throwing stub, cast to the BetterSqliteDatabase shape.
    let calls = 0;
    return {
      calls,
      loadExtension: () => {
        calls++;
        throw new Error('simulated: extension binary missing');
      },
    };
  }

  it('throws when NODE_ENV=test and loadExtension fails', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.CONTEXTOS_REQUIRE_VEC;
    const stub = stubDb();
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: test-only injection of a throwing stub
      loadSqliteVecOrFail(stub as unknown as any),
    ).toThrow(/sqlite_vec_unavailable/);
  });

  it('throws when CONTEXTOS_REQUIRE_VEC=1 regardless of NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    process.env.CONTEXTOS_REQUIRE_VEC = '1';
    const stub = stubDb();
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: test-only injection of a throwing stub
      loadSqliteVecOrFail(stub as unknown as any),
    ).toThrow(/sqlite_vec_unavailable/);
  });

  it('fails open (WARN, no throw) when neither strict env is set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CONTEXTOS_REQUIRE_VEC;
    const stub = stubDb();
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: test-only injection of a throwing stub
      loadSqliteVecOrFail(stub as unknown as any),
    ).not.toThrow();
  });
});
