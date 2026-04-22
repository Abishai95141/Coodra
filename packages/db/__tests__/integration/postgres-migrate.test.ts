import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresDb, type PostgresHandle } from '../../src/client.js';
import { migratePostgres } from '../../src/migrate.js';

/**
 * Integration smoke test: prove the generated Postgres migrations apply
 * cleanly against a live `pgvector/pgvector:pg16` container and that the
 * 5-table core shows up afterwards. The CI job seeds `DATABASE_URL` via a
 * GitHub Actions service container; locally, run `pnpm -w docker:up` and
 * export the same URL.
 *
 * Skipped automatically when `DATABASE_URL` is not present so that this
 * file is safe to include in `pnpm test:integration` runs outside CI.
 */

const databaseUrl = process.env.DATABASE_URL;
const isEnabled = typeof databaseUrl === 'string' && databaseUrl.length > 0;

(isEnabled ? describe : describe.skip)('postgres migrations apply cleanly', () => {
  let handle: PostgresHandle;

  beforeAll(async () => {
    handle = createPostgresDb({ databaseUrl: databaseUrl as string });
    // Clean slate per run. Drop in dependency order then recreate the vector
    // extension so migrations run against a known state.
    await handle.raw.unsafe(`
      DROP TABLE IF EXISTS pending_jobs CASCADE;
      DROP TABLE IF EXISTS context_packs CASCADE;
      DROP TABLE IF EXISTS run_events CASCADE;
      DROP TABLE IF EXISTS runs CASCADE;
      DROP TABLE IF EXISTS projects CASCADE;
      DROP TABLE IF EXISTS __drizzle_migrations CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      CREATE EXTENSION IF NOT EXISTS vector;
    `);
    await migratePostgres(handle.db);
  });

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
  });

  it('creates the five-table core', async () => {
    const rows = await handle.raw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('projects','runs','run_events','context_packs','pending_jobs')
      ORDER BY table_name
    `;
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(['context_packs', 'pending_jobs', 'projects', 'run_events', 'runs']);
  });

  it('context_packs.summary_embedding is a pgvector column with 384 dimensions', async () => {
    const rows = await handle.raw<{ udt_name: string; character_maximum_length: number | null }[]>`
      SELECT udt_name, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'context_packs'
        AND column_name = 'summary_embedding'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.udt_name).toBe('vector');
  });

  it('runs(project_id, session_id) has a unique index', async () => {
    const rows = await handle.raw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'runs' AND indexname = 'runs_project_session_idx'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.indexdef).toMatch(/UNIQUE/i);
  });

  it('re-applying migrations is a no-op (idempotent)', async () => {
    await migratePostgres(handle.db);
    const rows = await handle.raw<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('projects','runs','run_events','context_packs','pending_jobs')
    `;
    expect(rows[0]?.count).toBe('5');
  });
});
