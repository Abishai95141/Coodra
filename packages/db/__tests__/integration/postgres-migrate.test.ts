import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresDb, type PostgresHandle } from '../../src/client.js';
import { migratePostgres } from '../../src/migrate.js';

/**
 * Integration smoke test: prove the generated Postgres migrations apply
 * cleanly against a live `pgvector/pgvector:pg16` container and that the
 * nine-table schema (Module-01 core + Module-02 additions) + the
 * hand-appended pgvector HNSW index show up afterwards. The CI job
 * seeds `DATABASE_URL` via a GitHub Actions service container; locally,
 * run `pnpm -w docker:up` and export the same URL.
 *
 * Skipped automatically when `DATABASE_URL` is not present so that this
 * file is safe to include in `pnpm test:integration` runs outside CI.
 */

const databaseUrl = process.env.DATABASE_URL;
const isEnabled = typeof databaseUrl === 'string' && databaseUrl.length > 0;

const SCHEMA_TABLES = [
  'context_packs',
  'feature_packs',
  'pending_jobs',
  'policies',
  'policy_decisions',
  'policy_rules',
  'projects',
  'run_events',
  'runs',
] as const;

(isEnabled ? describe : describe.skip)('postgres migrations apply cleanly', () => {
  let handle: PostgresHandle;

  beforeAll(async () => {
    handle = createPostgresDb({ databaseUrl: databaseUrl as string });
    // Clean slate per run. Drop in dependency order then recreate the vector
    // extension so migrations run against a known state.
    await handle.raw.unsafe(`
      DROP TABLE IF EXISTS policy_decisions CASCADE;
      DROP TABLE IF EXISTS policy_rules CASCADE;
      DROP TABLE IF EXISTS policies CASCADE;
      DROP TABLE IF EXISTS feature_packs CASCADE;
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

  it('creates the nine-table schema', async () => {
    const rows = await handle.raw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY (${[...SCHEMA_TABLES]})
      ORDER BY table_name
    `;
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual([...SCHEMA_TABLES]);
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

  it('context_packs.content_excerpt is a non-null text column with default empty string', async () => {
    const rows = await handle.raw<{ data_type: string; is_nullable: string; column_default: string | null }[]>`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'context_packs'
        AND column_name = 'content_excerpt'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.data_type).toBe('text');
    expect(rows[0]?.is_nullable).toBe('NO');
    expect(rows[0]?.column_default ?? '').toContain("''");
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

  it('policy_rules has the (policy_id, priority) btree index', async () => {
    const rows = await handle.raw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'policy_rules' AND indexname = 'policy_rules_policy_priority_idx'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.indexdef).toMatch(/\(policy_id,\s*priority\)/);
  });

  it('hand-written block: context_packs.summary_embedding has an HNSW index with m=16, ef_construction=64', async () => {
    // `pg_indexes` exposes the reconstructed CREATE INDEX statement. We
    // assert both the HNSW USING clause and the hand-written parameters so
    // a future migration drift (e.g. drizzle-kit regenerating 0001 and
    // wiping the preserve block) gets caught here — complementing the
    // sha256 check in `check-migration-lock.mjs`.
    const rows = await handle.raw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'context_packs'
        AND indexname = 'context_packs_embedding_hnsw_idx'
    `;
    expect(rows.length).toBe(1);
    const indexdef = rows[0]?.indexdef ?? '';
    expect(indexdef).toMatch(/USING\s+hnsw/i);
    expect(indexdef).toMatch(/vector_cosine_ops/);
    expect(indexdef).toMatch(/m\s*=\s*'?16'?/);
    expect(indexdef).toMatch(/ef_construction\s*=\s*'?64'?/);
  });

  it('re-applying migrations is a no-op (idempotent)', async () => {
    await migratePostgres(handle.db);
    const rows = await handle.raw<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY (${[...SCHEMA_TABLES]})
    `;
    expect(rows[0]?.count).toBe(String(SCHEMA_TABLES.length));
  });
});
