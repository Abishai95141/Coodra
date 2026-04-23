import { describe, expect, it } from 'vitest';

import type { DbClient } from '../../../src/framework/tool-context.js';
import { NotImplementedError } from '../../../src/lib/errors.js';
import { createFeaturePackStore } from '../../../src/lib/feature-pack.js';

/**
 * Integration test for `src/lib/feature-pack.ts`.
 *
 * The store is a stub in S7a: all methods throw
 * `NotImplementedError('feature-pack.*')`. The test locks:
 *   - factory succeeds when `deps.db` is present (no side effects);
 *   - factory rejects a missing `deps.db` at construction time so
 *     misconfiguration fails fast;
 *   - every method throws `NotImplementedError` so a caller that
 *     reaches the stub by accident in production would see an
 *     unambiguous error code, not a silent empty result.
 */

const fakeDb: DbClient = {
  db: {},
  async close() {
    /* no-op */
  },
};

describe('lib/feature-pack — createFeaturePackStore', () => {
  it('constructs when given a DbClient', () => {
    const store = createFeaturePackStore({ db: fakeDb });
    expect(store).toBeDefined();
    expect(typeof store.get).toBe('function');
    expect(typeof store.list).toBe('function');
    expect(typeof store.upsert).toBe('function');
  });

  it('rejects a missing DbClient at construction time', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createFeaturePackStore({} as any)).toThrow(/deps\.db is required/);
  });

  it('get() throws NotImplementedError until S7c', async () => {
    const store = createFeaturePackStore({ db: fakeDb });
    await expect(store.get({ projectSlug: 'foo' })).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('list() throws NotImplementedError until S7c', async () => {
    const store = createFeaturePackStore({ db: fakeDb });
    await expect(store.list({ projectSlug: 'foo' })).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('upsert() throws NotImplementedError until S7c', async () => {
    const store = createFeaturePackStore({ db: fakeDb });
    await expect(store.upsert({})).rejects.toBeInstanceOf(NotImplementedError);
  });
});
