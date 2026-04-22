import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ValidationError } from '@contextos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDb, createSqliteDb, resolveSqlitePath } from '../../src/client.js';
import { migrateSqlite } from '../../src/migrate.js';
import * as sqliteSchema from '../../src/schema/sqlite.js';

describe('resolveSqlitePath', () => {
  it('passes through :memory:', () => {
    expect(resolveSqlitePath(':memory:')).toBe(':memory:');
  });

  it('expands a leading ~ to the home directory', () => {
    const resolved = resolveSqlitePath('~/.contextos/data.db');
    expect(resolved).toMatch(/\.contextos\/data\.db$/);
    expect(resolved.startsWith('~')).toBe(false);
  });

  it('resolves a relative path to an absolute one', () => {
    const resolved = resolveSqlitePath('./test.db');
    expect(resolved.endsWith('/test.db')).toBe(true);
    expect(resolved.startsWith('/')).toBe(true);
  });
});

describe('createSqliteDb (in-memory)', () => {
  it('returns a SqliteHandle with a working raw handle', () => {
    const handle = createSqliteDb({ path: ':memory:' });
    try {
      expect(handle.kind).toBe('sqlite');
      expect(handle.db).toBeDefined();
      expect(handle.raw).toBeDefined();
      const row = handle.raw.prepare('SELECT 1 AS n').get() as { n: number };
      expect(row.n).toBe(1);
    } finally {
      handle.close();
    }
  });

  it('applies the recommended PRAGMAs by default', () => {
    const handle = createSqliteDb({ path: ':memory:' });
    try {
      // `cache_size = -64000` is one of our recommended PRAGMAs and is a
      // value no better-sqlite3 default would ever produce, so seeing it
      // back confirms our PRAGMA loop ran.
      const cacheSize = handle.raw.pragma('cache_size', { simple: true });
      expect(cacheSize).toBe(-64000);
      const fk = handle.raw.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    } finally {
      handle.close();
    }
  });

  it('skips PRAGMAs when skipPragmas: true (cache_size stays at the driver default)', () => {
    const handle = createSqliteDb({ path: ':memory:', skipPragmas: true });
    try {
      const cacheSize = handle.raw.pragma('cache_size', { simple: true });
      // Driver default is -2000 (2 MiB). The key assertion is that it is
      // *not* our custom -64000, which would indicate we ran PRAGMAs anyway.
      expect(cacheSize).not.toBe(-64000);
    } finally {
      handle.close();
    }
  });
});

describe('createSqliteDb + migrateSqlite on a file-backed DB', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'contextos-db-'));
    dbPath = join(tmp, 'test.db');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('applies the generated migrations and creates the 5-table core', () => {
    const handle = createSqliteDb({ path: dbPath });
    try {
      migrateSqlite(handle.db);
      const rows = handle.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      const tables = rows.map((r) => r.name);
      expect(tables).toEqual(['context_packs', 'pending_jobs', 'projects', 'run_events', 'runs']);
    } finally {
      handle.close();
    }
  });

  it('re-applying migrations is a no-op (idempotent)', () => {
    const first = createSqliteDb({ path: dbPath });
    try {
      migrateSqlite(first.db);
      migrateSqlite(first.db); // second call must not throw or duplicate schema
      const rows = first.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%' AND name NOT LIKE 'sqlite_%'",
        )
        .get() as { n: number };
      expect(rows.n).toBe(5);
    } finally {
      first.close();
    }
  });

  it('accepts inserts + selects through the Drizzle client on the migrated schema', () => {
    const handle = createSqliteDb({ path: dbPath });
    try {
      migrateSqlite(handle.db);
      const now = new Date();
      handle.db
        .insert(sqliteSchema.projects)
        .values({ id: 'proj_1', slug: 'acme', orgId: 'org_dev_local', name: 'Acme', createdAt: now, updatedAt: now })
        .run();
      const projects = handle.db.select().from(sqliteSchema.projects).all();
      expect(projects).toHaveLength(1);
      expect(projects[0]?.slug).toBe('acme');
    } finally {
      handle.close();
    }
  });
});

describe('createDb (mode dispatch)', () => {
  it('solo mode returns a sqlite handle', () => {
    const handle = createDb({ mode: 'solo', sqlite: { path: ':memory:' } });
    try {
      expect(handle.kind).toBe('sqlite');
    } finally {
      if (handle.kind === 'sqlite') handle.close();
    }
  });

  it('team mode without databaseUrl throws ValidationError', () => {
    const previousMode = process.env.CONTEXTOS_MODE;
    const previousUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => createDb({ mode: 'team' })).toThrow(ValidationError);
    } finally {
      if (previousMode !== undefined) process.env.CONTEXTOS_MODE = previousMode;
      if (previousUrl !== undefined) process.env.DATABASE_URL = previousUrl;
    }
  });

  it('defaults to solo when CONTEXTOS_MODE is unset', () => {
    const previousMode = process.env.CONTEXTOS_MODE;
    delete process.env.CONTEXTOS_MODE;
    try {
      const handle = createDb({ sqlite: { path: ':memory:' } });
      try {
        expect(handle.kind).toBe('sqlite');
      } finally {
        if (handle.kind === 'sqlite') handle.close();
      }
    } finally {
      if (previousMode !== undefined) process.env.CONTEXTOS_MODE = previousMode;
    }
  });
});
