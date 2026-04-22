import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
