import type { Sql } from 'postgres';

/**
 * `_helpers/postgres-clean` — introspecting cleanup for integration tests.
 *
 * The previous pattern (hand-rolled `DROP TABLE IF EXISTS …` lists per test
 * file) silently goes stale every time a new module adds a table. Module 02
 * shipped `decisions`; both `postgres-migrate.test.ts` and `cloud-mode-write.
 * test.ts` failed to add it to their DROP block, which broke `pnpm
 * test:integration` against the long-running compose Postgres (verification
 * F3, 2026-04-27 report).
 *
 * This helper queries `information_schema.tables` at runtime, enumerates
 * every user-created table in the `public` schema, and drops them with
 * CASCADE. It also drops the `drizzle` schema (the one Drizzle uses for
 * `__drizzle_migrations` post-migrate) and recreates the `vector`
 * extension so subsequent migrations have the dependency they need.
 *
 * Idempotent — safe to call against a fresh DB or a fully-migrated one.
 *
 * Postgres-only. SQLite tests do not need this helper (each suite uses a
 * fresh `:memory:` handle per test or a temp-file path that's removed
 * via `afterAll`).
 */
export async function dropAllPublicTables(sql: Sql): Promise<void> {
  // Discover every user table in the public schema. Excludes views,
  // foreign tables, and pg_catalog noise.
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `;

  // CASCADE handles FK ordering automatically; we don't need to compute
  // dependency order ourselves. Use parameterised identifiers via
  // sql.unsafe — table names are already trusted (they came from the
  // catalog). Wrapping each name in double quotes preserves any
  // capitalisation Drizzle introduces.
  for (const { table_name } of rows) {
    await sql.unsafe(`DROP TABLE IF EXISTS "${table_name}" CASCADE`);
  }

  // Drizzle stores migration metadata in a separate `drizzle` schema.
  // Dropping the schema with CASCADE removes `__drizzle_migrations` and
  // any other migration-internal artefacts.
  await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');

  // Restore pgvector — migrations use the `vector` type which requires
  // the extension to be present before migrate runs.
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
}
