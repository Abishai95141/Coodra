import { describe, expect, it } from 'vitest';

import type { DbClient } from '../../../src/framework/tool-context.js';
import { NotImplementedError } from '../../../src/lib/errors.js';
import { createSqliteVecClient } from '../../../src/lib/sqlite-vec.js';

/**
 * Integration test for `src/lib/sqlite-vec.ts`.
 *
 * S7a stub. Locks the user-directive "domain-shaped API, not a raw
 * query executor" surface: the ONLY method on `SqliteVecClient` is
 * `searchSimilarPacks({ embedding, k, filter? })`. A grep for a
 * `.run()` or `.query()` method on the returned client would fail;
 * this test asserts that by shape.
 *
 * The real impl (and its embedding-dim assertion against
 * `@contextos/shared::EMBEDDING_DIM = 384`) lands in S7c.
 */

const fakeDb: DbClient = {
  db: {},
  async close() {
    /* no-op */
  },
};

describe('lib/sqlite-vec — createSqliteVecClient', () => {
  it('constructs when given a DbClient', () => {
    const client = createSqliteVecClient({ db: fakeDb });
    expect(typeof client.searchSimilarPacks).toBe('function');
  });

  it('exposes only domain methods (no raw SQL runner)', () => {
    const client = createSqliteVecClient({ db: fakeDb }) as unknown as Record<string, unknown>;
    // Domain surface
    expect(typeof client.searchSimilarPacks).toBe('function');
    // Negative: raw query-executor names are not exposed. If you need
    // to add SQL, add a new domain method instead — see the docblock
    // in `src/lib/sqlite-vec.ts`.
    expect(client.run).toBeUndefined();
    expect(client.query).toBeUndefined();
    expect(client.exec).toBeUndefined();
    expect(client.prepare).toBeUndefined();
  });

  it('rejects a missing DbClient at construction time', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createSqliteVecClient({} as any)).toThrow(/deps\.db is required/);
  });

  it('searchSimilarPacks throws NotImplementedError until S7c', async () => {
    const client = createSqliteVecClient({ db: fakeDb });
    const embedding = new Float32Array(384);
    await expect(client.searchSimilarPacks({ embedding, k: 5 })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
