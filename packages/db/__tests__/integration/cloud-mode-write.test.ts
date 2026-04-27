import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type PostgresHandle } from '../../src/client.js';
import { ensurePgVector, migratePostgres } from '../../src/migrate.js';
import * as postgresSchema from '../../src/schema/postgres.js';
import { dropAllPublicTables } from './_helpers/postgres-clean.js';

/**
 * Module 03 S13: prove the `kind: 'cloud'` branch of `createDb` works.
 *
 * Local services (mcp-server + hooks-bridge) always use sqlite per
 * S4. The cloud branch is reserved for future cloud-side processes
 * (Sync Daemon, cloud-api). This test boots one against a CI-provided
 * Postgres container, runs migrations, and writes + reads a `runs`
 * row to prove the dialect path is wired end-to-end.
 *
 * Skipped automatically when DATABASE_URL is not present so the file
 * is safe to include in `pnpm test:integration` runs outside CI.
 */

const databaseUrl = process.env.DATABASE_URL;
const isEnabled = typeof databaseUrl === 'string' && databaseUrl.length > 0;

(isEnabled ? describe : describe.skip)('createDb({ kind: cloud }) — Postgres branch', () => {
  let handle: PostgresHandle;
  const projectId = randomUUID();
  const projectSlug = `cloud-test-${projectId.slice(0, 8)}`;
  const sessionId = `sess-cloud-${randomUUID().slice(0, 8)}`;
  const runId = randomUUID();

  beforeAll(async () => {
    const opened = createDb({ kind: 'cloud', postgres: { databaseUrl: databaseUrl as string } });
    if (opened.kind !== 'postgres') throw new Error('expected kind=postgres');
    handle = opened;
    // Clean slate via the introspecting helper (also re-creates the
    // pgvector extension migrate needs). Replaces a hand-rolled DROP
    // list that silently went stale when Module 02 added `decisions`
    // (verification F3, 2026-04-27).
    await dropAllPublicTables(handle.raw);
    await ensurePgVector(handle.db);
    await migratePostgres(handle.db);
  });

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
  });

  it('writes a runs row through the cloud handle and reads it back', async () => {
    // Seed parent project (FK dependency).
    await handle.db.insert(postgresSchema.projects).values({
      id: projectId,
      slug: projectSlug,
      orgId: 'org_cloud_test',
      name: 'cloud-mode-write',
    });

    // Insert a run row.
    await handle.db.insert(postgresSchema.runs).values({
      id: runId,
      projectId,
      sessionId,
      agentType: 'claude_code',
      mode: 'team',
      status: 'in_progress',
    });

    // Read it back.
    const rows = await handle.db.select().from(postgresSchema.runs).where(eq(postgresSchema.runs.id, runId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.projectId).toBe(projectId);
    expect(rows[0]?.sessionId).toBe(sessionId);
    expect(rows[0]?.agentType).toBe('claude_code');
    expect(rows[0]?.mode).toBe('team');
    expect(rows[0]?.status).toBe('in_progress');
  });

  it('createDb({ kind: cloud }) without databaseUrl + no DATABASE_URL env throws', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => createDb({ kind: 'cloud' })).toThrow(/DATABASE_URL/);
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });
});
