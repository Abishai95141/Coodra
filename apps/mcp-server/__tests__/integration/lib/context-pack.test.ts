import { describe, expect, it } from 'vitest';

import type { DbClient } from '../../../src/framework/tool-context.js';
import { createContextPackStore } from '../../../src/lib/context-pack.js';
import { NotImplementedError } from '../../../src/lib/errors.js';

/**
 * Integration test for `src/lib/context-pack.ts`.
 *
 * S7a stub behaviour. Also pins the user-directive Q3 contract: the
 * `write(pack, embedding)` signature accepts `Float32Array | null`
 * — the store NEVER computes an embedding itself (that is Module 04).
 * The null branch is valid input, not an error.
 */

const fakeDb: DbClient = {
  db: {},
  async close() {
    /* no-op */
  },
};

describe('lib/context-pack — createContextPackStore', () => {
  it('constructs when given a DbClient', () => {
    const store = createContextPackStore({ db: fakeDb });
    expect(typeof store.write).toBe('function');
    expect(typeof store.read).toBe('function');
    expect(typeof store.list).toBe('function');
  });

  it('rejects a missing DbClient at construction time', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createContextPackStore({} as any)).toThrow(/deps\.db is required/);
  });

  it('write(pack, Float32Array) throws NotImplementedError until S7c', async () => {
    const store = createContextPackStore({ db: fakeDb });
    const embedding = new Float32Array(384);
    await expect(store.write({}, embedding)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('write(pack, null) is a legal call (no throw on the null, throws NotImplementedError on impl)', async () => {
    const store = createContextPackStore({ db: fakeDb });
    // Null embedding is a first-class value per user directive Q3.
    // The stub throws NotImplementedError regardless; the important
    // invariant is that the TYPE accepts null and the stub does not
    // reject on null specifically.
    await expect(store.write({}, null)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('read() and list() throw NotImplementedError until S7c', async () => {
    const store = createContextPackStore({ db: fakeDb });
    await expect(store.read('run_xyz')).rejects.toBeInstanceOf(NotImplementedError);
    await expect(store.list({ projectSlug: 'foo' })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
