import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle config for the SQLite dialect (solo-mode primary store per
 * `system-architecture.md` §4.1). Runs `drizzle-kit generate` against
 * `src/schema/sqlite.ts`, writing numbered SQL migrations to
 * `drizzle/sqlite/`. The `dbCredentials.url` is a dev placeholder; the
 * actual runtime path is resolved by `createDb()` (see `src/client.ts`).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/sqlite.ts',
  out: './drizzle/sqlite',
  dbCredentials: {
    url: process.env.CONTEXTOS_SQLITE_PATH ?? './drizzle/.tmp/contextos.db',
  },
  verbose: true,
  strict: true,
});
