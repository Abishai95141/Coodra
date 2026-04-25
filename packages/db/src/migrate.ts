import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate as betterSqliteMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate as postgresMigrate } from 'drizzle-orm/postgres-js/migrator';

import type { PostgresDb, SqliteDb } from './client.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Paths to the generated migration folders for each dialect. When the
 * package is built to `dist/`, the source `drizzle/` directory sits two
 * levels above (package root). We resolve relative to the compiled
 * module so consumers that import the compiled bundle still find the SQL.
 */
export const MIGRATIONS_FOLDER = {
  sqlite: resolve(moduleDir, '..', 'drizzle', 'sqlite'),
  postgres: resolve(moduleDir, '..', 'drizzle', 'postgres'),
} as const;

/**
 * Apply every SQLite migration in `drizzle/sqlite/` in order. Synchronous
 * by design — better-sqlite3 is sync. Safe to call repeatedly; migrations
 * are tracked in the `__drizzle_migrations` table.
 */
export function migrateSqlite(db: SqliteDb, migrationsFolder: string = MIGRATIONS_FOLDER.sqlite): void {
  betterSqliteMigrate(db, { migrationsFolder });
}

/**
 * Apply every Postgres migration in `drizzle/postgres/` in order. Awaits
 * the migrator because postgres-js is async.
 */
export async function migratePostgres(
  db: PostgresDb,
  migrationsFolder: string = MIGRATIONS_FOLDER.postgres,
): Promise<void> {
  await postgresMigrate(db, { migrationsFolder });
}

/**
 * Convenience helper for tests and scripts that only need a co-located
 * migrations folder lookup. Exported so downstream modules don't hard-code
 * the relative path layout.
 */
export function resolveMigrationsFolder(dialect: 'sqlite' | 'postgres', packageRoot: string): string {
  return join(packageRoot, 'drizzle', dialect);
}

/**
 * Ensure the pgvector extension exists on the target Postgres database.
 *
 * Migration `0000_*` references `vector(384)` BEFORE `0001_*` runs the
 * `CREATE EXTENSION IF NOT EXISTS vector` safety net. On a brand-new
 * database the type is unknown and the CREATE TABLE fails. The mcp-server
 * boot path + the e2e test harness call this helper BEFORE
 * `migratePostgres()` so 0000 finds the type defined.
 *
 * The `pgvector/pgvector:pg16` image bundles the extension binary; this
 * just opts the database in. Idempotent (`IF NOT EXISTS`).
 */
export async function ensurePgVector(db: PostgresDb): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
}
