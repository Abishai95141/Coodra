import { describe, expect, it } from 'vitest';

import { createDbClient, type InternalDbHandle } from '../../../src/lib/db.js';

/**
 * Integration test for `src/lib/db.ts`.
 *
 * Opens a real `:memory:` SQLite DB through the factory, issues a
 * trivial SELECT to prove the Drizzle binding is live, then closes.
 * The sqlite-vec extension is disabled here (`loadVecExtension:
 * false`) — S7c's `lib/sqlite-vec.ts` integration test covers the
 * extension-loaded path.
 *
 * Each lib module owns exactly one integration test per the S7a
 * user directive; this file is the entry for `db`.
 */

describe('lib/db — createDbClient factory', () => {
  it('opens a :memory: SQLite handle and supports a trivial query', async () => {
    const { client, asInternalHandle } = createDbClient({
      mode: 'solo',
      sqlite: { path: ':memory:', loadVecExtension: false, skipPragmas: true },
    });
    try {
      const handle: InternalDbHandle = asInternalHandle();
      expect(handle.kind).toBe('sqlite');
      if (handle.kind !== 'sqlite') {
        throw new Error('expected sqlite handle in solo mode');
      }
      const row = handle.raw.prepare('SELECT 1 AS one').get() as { one: number };
      expect(row.one).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('close() is idempotent — a second call is a no-op', async () => {
    const { client } = createDbClient({
      mode: 'solo',
      sqlite: { path: ':memory:', loadVecExtension: false, skipPragmas: true },
    });
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('_testOverrideInMemory is a shorthand for in-memory + no extension', async () => {
    const { client, asInternalHandle } = createDbClient({ _testOverrideInMemory: true });
    try {
      expect(asInternalHandle().kind).toBe('sqlite');
    } finally {
      await client.close();
    }
  });
});
