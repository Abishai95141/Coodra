import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createLogger, InternalError, ValidationError } from '@contextos/shared';
import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as sqliteVec from 'sqlite-vec';

import * as postgresSchema from './schema/postgres.js';
import * as sqliteSchema from './schema/sqlite.js';

const clientLogger = createLogger('db.sqlite-vec-loader');

/**
 * The SQLite Drizzle client shape used by solo-mode services and by every
 * local service in team mode (per `system-architecture.md` §4.2).
 */
export type SqliteDb = BetterSQLite3Database<typeof sqliteSchema>;

/**
 * The Postgres Drizzle client shape used by cloud services in team mode.
 * Local services never call `createPostgresDb` in team mode — the Sync
 * Daemon is the only dual-connection consumer.
 */
export type PostgresDb = PostgresJsDatabase<typeof postgresSchema>;

export interface CreateSqliteDbOptions {
  /**
   * Filesystem path to the SQLite database. `:memory:` is accepted for
   * tests. Defaults to `~/.contextos/data.db` when omitted, with the
   * parent directory created on demand.
   */
  path?: string;

  /** Skip setting the recommended PRAGMAs (for ephemeral test DBs). */
  skipPragmas?: boolean;

  /**
   * Load the `sqlite-vec` loadable extension on the raw connection so the
   * `context_packs_vec` vec0 virtual table (and future vec0 tables) are
   * usable by this handle. Defaults to `true`.
   *
   * Failure handling (per decision 2026-04-22 22:08):
   *   - `NODE_ENV=test` or `CONTEXTOS_REQUIRE_VEC=1` → throw
   *     `InternalError('sqlite_vec_unavailable')`. Dev and test must not
   *     silently degrade — a missing extension would hide embedding-index
   *     regressions.
   *   - otherwise → log a WARN line tagged `sqlite_vec_unavailable` and
   *     continue. This is the production fail-open path
   *     (`system-architecture.md` §7): the server still serves contextual
   *     reads and falls back to LIKE-over-`content_excerpt`.
   */
  loadVecExtension?: boolean;
}

export interface CreatePostgresDbOptions {
  /** PG connection string. Required when mode is `team`. */
  databaseUrl: string;
  /** Connection pool max size. Defaults to 5 per service instance per §4.2. */
  max?: number;
  /**
   * Must be `false` when connecting through Supabase's Supavisor transaction
   * pooler. Defaults to `false` because that is the production target; a
   * direct Postgres connection also tolerates `prepare: false`.
   */
  prepare?: boolean;
}

export interface SqliteHandle {
  readonly kind: 'sqlite';
  readonly db: SqliteDb;
  readonly raw: BetterSqliteDatabase;
  readonly close: () => void;
}

export interface PostgresHandle {
  readonly kind: 'postgres';
  readonly db: PostgresDb;
  readonly raw: Sql;
  readonly close: () => Promise<void>;
}

export type DbHandle = SqliteHandle | PostgresHandle;

const RECOMMENDED_PRAGMAS: ReadonlyArray<string> = [
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'cache_size = -64000',
  'foreign_keys = ON',
  'temp_store = MEMORY',
];

/** Expand a leading `~` to the OS home directory. */
function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/** Resolve the effective SQLite path, applying defaults and home-expansion. */
export function resolveSqlitePath(input: string | undefined): string {
  const raw = input ?? process.env.CONTEXTOS_SQLITE_PATH ?? '~/.contextos/data.db';
  if (raw === ':memory:') {
    return raw;
  }
  const expanded = expandHome(raw);
  return resolve(expanded);
}

/**
 * Whether the current process requires sqlite-vec to load successfully.
 * In `test` and explicit opt-in contexts, a silent fallback would hide
 * embedding-path regressions; so we throw. Production defaults to WARN.
 * Environment variables are re-read on every call so test code can flip
 * `CONTEXTOS_REQUIRE_VEC` at runtime without re-importing the module.
 */
function vecLoadIsRequired(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.CONTEXTOS_REQUIRE_VEC === '1';
}

/**
 * Attempt to load the `sqlite-vec` loadable extension on the given raw
 * `better-sqlite3` handle. On failure: throw when the process is in a
 * must-not-silently-degrade environment, otherwise WARN and continue.
 * Exported so integration tests can cover both branches directly.
 */
export function loadSqliteVecOrFail(raw: BetterSqliteDatabase): void {
  let loadablePath = '<unknown>';
  try {
    try {
      loadablePath = sqliteVec.getLoadablePath();
    } catch {
      // `getLoadablePath` can throw on unsupported platforms before we even
      // reach `load`; keep the placeholder so the log line still has a slot.
    }
    sqliteVec.load(raw);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const meta = {
      event: 'sqlite_vec_unavailable',
      loadablePath,
      platform: process.platform,
      arch: process.arch,
      err: message,
    };
    if (vecLoadIsRequired()) {
      clientLogger.error(meta, 'sqlite_vec_unavailable: strict mode, aborting SQLite handle creation');
      throw new InternalError(`sqlite_vec_unavailable: ${message}`, cause);
    }
    clientLogger.warn(meta, 'sqlite_vec_unavailable: falling back to LIKE search path');
  }
}

/**
 * Open (or create) a SQLite-backed Drizzle client per §4.1. The returned
 * handle carries a `.close()` the caller is expected to invoke during
 * shutdown. The `sqlite-vec` loadable extension is loaded by default;
 * see `CreateSqliteDbOptions.loadVecExtension` for the failure-handling
 * contract.
 */
export function createSqliteDb(options: CreateSqliteDbOptions = {}): SqliteHandle {
  const path = resolveSqlitePath(options.path);
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const raw = new Database(path);
  if (options.skipPragmas !== true) {
    for (const pragma of RECOMMENDED_PRAGMAS) {
      raw.pragma(pragma);
    }
  }
  if (options.loadVecExtension !== false) {
    try {
      loadSqliteVecOrFail(raw);
    } catch (err) {
      raw.close();
      throw err;
    }
  }
  const db = drizzleSqlite(raw, { schema: sqliteSchema });
  return {
    kind: 'sqlite',
    db,
    raw,
    close: () => {
      raw.close();
    },
  };
}

/**
 * Open a Postgres-backed Drizzle client per §4.2. Throws when
 * `databaseUrl` is empty.
 */
export function createPostgresDb(options: CreatePostgresDbOptions): PostgresHandle {
  if (!options.databaseUrl || typeof options.databaseUrl !== 'string') {
    throw new ValidationError('createPostgresDb: databaseUrl is required and must be a non-empty string');
  }
  const raw = postgres(options.databaseUrl, {
    max: options.max ?? 5,
    prepare: options.prepare ?? false,
  });
  const db = drizzlePostgres(raw, { schema: postgresSchema });
  return {
    kind: 'postgres',
    db,
    raw,
    close: async () => {
      await raw.end({ timeout: 5 });
    },
  };
}

export interface CreateDbOptions {
  /** `'solo' | 'team'`. When omitted, reads `CONTEXTOS_MODE` then falls back to `'solo'`. */
  mode?: 'solo' | 'team';
  /** SQLite-specific knobs. Ignored when the resolved mode is `'team'`. */
  sqlite?: CreateSqliteDbOptions;
  /** Postgres-specific knobs. Required when the resolved mode is `'team'`. */
  postgres?: CreatePostgresDbOptions;
}

/**
 * Mode-dispatching factory. Module 01 ships this wired for local services:
 * solo mode → SQLite; team mode → Postgres. Services that always want one
 * specific dialect should call `createSqliteDb` / `createPostgresDb`
 * directly; the Sync Daemon in Module 03+ holds both simultaneously.
 */
export function createDb(options: CreateDbOptions = {}): DbHandle {
  const mode = options.mode ?? (process.env.CONTEXTOS_MODE === 'team' ? 'team' : 'solo');
  if (mode === 'team') {
    if (!options.postgres) {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new ValidationError(
          'createDb: mode=team requires either options.postgres.databaseUrl or the DATABASE_URL env var',
        );
      }
      return createPostgresDb({ databaseUrl });
    }
    return createPostgresDb(options.postgres);
  }
  return createSqliteDb(options.sqlite ?? {});
}
