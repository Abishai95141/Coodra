import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresDb, type PostgresHandle } from '../../../src/client.js';
import { migratePostgres } from '../../../src/migrate.js';
import { dropAllPublicTables } from './postgres-clean.js';

/**
 * Locks the F3 fix from regressing — proves `dropAllPublicTables`
 * removes every user table even after a future module adds new tables
 * (the helper introspects rather than relying on a hand-rolled list).
 */

const databaseUrl = process.env.DATABASE_URL;
const isEnabled = typeof databaseUrl === 'string' && databaseUrl.length > 0;

(isEnabled ? describe : describe.skip)('_helpers/postgres-clean::dropAllPublicTables', () => {
  let handle: PostgresHandle;

  beforeAll(async () => {
    handle = createPostgresDb({ databaseUrl: databaseUrl as string });
  });

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
  });

  it('drops every user table from a fully migrated DB', async () => {
    await dropAllPublicTables(handle.raw);
    await migratePostgres(handle.db);
    // Confirm migrations ran clean.
    const before = await handle.raw<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    expect(Number(before[0]?.count ?? '0')).toBeGreaterThanOrEqual(10);

    // Now drop everything.
    await dropAllPublicTables(handle.raw);

    const after = await handle.raw<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    expect(after[0]?.count).toBe('0');
  });

  it('is idempotent against an empty DB', async () => {
    // Empty already from the previous test. Calling again must not throw.
    await dropAllPublicTables(handle.raw);
    await dropAllPublicTables(handle.raw);
    const rows = await handle.raw<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    expect(rows[0]?.count).toBe('0');
  });

  it('drops a hypothetical future table that is not in any hand-rolled list', async () => {
    // Simulate "Module 04 adds a new table that no DROP-block knows about."
    await migratePostgres(handle.db);
    await handle.raw.unsafe(`CREATE TABLE "future_module_table" (id text PRIMARY KEY)`);

    await dropAllPublicTables(handle.raw);

    const rows = await handle.raw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'future_module_table'
    `;
    expect(rows.length).toBe(0);
  });

  it('restores the vector extension so subsequent migrate() runs find it', async () => {
    // After cleanup the helper recreates `vector`.
    const rows = await handle.raw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows.length).toBe(1);
  });

  it('drops the drizzle schema (and __drizzle_migrations within it)', async () => {
    await migratePostgres(handle.db);
    // After migrate, the `drizzle` schema exists.
    const before = await handle.raw<{ schema_name: string }[]>`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'drizzle'
    `;
    expect(before.length).toBe(1);

    await dropAllPublicTables(handle.raw);

    const after = await handle.raw<{ schema_name: string }[]>`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'drizzle'
    `;
    expect(after.length).toBe(0);
  });
});
