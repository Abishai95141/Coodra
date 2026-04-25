import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateSqlite, type SqliteHandle } from '@contextos/db';
import { EMBEDDING_DIM } from '@contextos/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextDeps } from '../../../src/framework/tool-context.js';
import { ToolRegistry } from '../../../src/framework/tool-registry.js';
import { createContextPackStore } from '../../../src/lib/context-pack.js';
import { createDbClient } from '../../../src/lib/db.js';
import { createSqliteVecClient } from '../../../src/lib/sqlite-vec.js';
import { createSearchPacksNlToolRegistration } from '../../../src/tools/search-packs-nl/manifest.js';
import type { SearchPacksNlOutput } from '../../../src/tools/search-packs-nl/schema.js';
import { makeFakeDeps } from '../../helpers/fake-deps.js';

/**
 * Integration test for `contextos__search_packs_nl` (S11).
 *
 * Exercises semantic + LIKE paths end-to-end via the ToolRegistry:
 *
 *   - Project-slug resolution → soft-failure on miss.
 *   - embedding_dim_mismatch soft-failure (handler-level check, NOT
 *     Zod — the generic invalid_input envelope is too opaque).
 *   - LIKE fallback when no embedding is supplied — returns
 *     notice:'no_embeddings_yet' + howToFix.
 *   - Empty-result path (valid query, zero hits) — returns
 *     { ok: true, packs: [] }, NOT a soft-failure.
 *   - Semantic path with a real 384-dim embedding via sqlite-vec.
 *
 * TEST-WRITER GUARD: always pass `contextPacksRoot=<tmpdir>` when
 * constructing createContextPackStore — the default
 * `process.cwd() + /docs/context-packs` leaks into the repo tree.
 */

interface Harness {
  readonly close: () => Promise<void>;
  readonly handle: SqliteHandle;
  readonly projectSlug: string;
  readonly projectId: string;
  readonly deps: ContextDeps;
}

function makeUnitVector(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  return v;
}

function makeUnitArray(axis: number): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[axis] = 1;
  return v;
}

async function openHarness(): Promise<Harness> {
  const { client, asInternalHandle } = createDbClient({
    mode: 'solo',
    // vec extension must load so migration 0001 creates context_packs_vec.
    sqlite: { path: ':memory:', skipPragmas: true },
  });
  const handle = asInternalHandle();
  if (handle.kind !== 'sqlite') throw new Error('expected sqlite handle');
  migrateSqlite(handle.db);

  const projectId = 'proj_snl';
  const projectSlug = 'slug-snl';
  handle.raw
    .prepare(`INSERT INTO projects (id, slug, org_id, name) VALUES (?, ?, ?, ?)`)
    .run(projectId, projectSlug, 'org_test', 'snl harness');

  const contextPacksRoot = mkdtempSync(join(tmpdir(), 'snl-cp-'));
  const contextPack = createContextPackStore({ db: handle, contextPacksRoot });
  const sqliteVec = createSqliteVecClient({ db: handle });

  const baseDeps = makeFakeDeps();
  const deps: ContextDeps = Object.freeze({ ...baseDeps, contextPack, sqliteVec });

  return {
    close: async () => {
      await client.close();
    },
    handle,
    projectSlug,
    projectId,
    deps,
  };
}

async function seedRun(handle: SqliteHandle, runId: string, projectId: string, sessionId: string): Promise<void> {
  handle.raw
    .prepare(
      `INSERT INTO runs (id, project_id, session_id, agent_type, mode, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, projectId, sessionId, 'claude_code', 'solo', 'in_progress');
}

function buildRegistry(h: Harness): ToolRegistry {
  const registry = new ToolRegistry({ deps: h.deps });
  registry.register(createSearchPacksNlToolRegistration({ db: h.handle }));
  return registry;
}

function unwrap(result: { readonly content: ReadonlyArray<{ type: string; text: string }> }): SearchPacksNlOutput {
  const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { ok: boolean; data?: SearchPacksNlOutput };
  if (!parsed.ok || !parsed.data) {
    throw new Error(`unexpected envelope: ${JSON.stringify(parsed)}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// project_not_found soft-failure
// ---------------------------------------------------------------------------

describe('search_packs_nl — project_not_found soft-failure', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns ok:false + error:project_not_found + howToFix for an unknown slug', async () => {
    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall('search_packs_nl', { projectSlug: 'not-a-project', query: 'anything' }, 'sess_snl'),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('project_not_found');
    expect(out.howToFix.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// embedding_dim_mismatch soft-failure (HANDLER-level, not Zod)
// ---------------------------------------------------------------------------

describe('search_packs_nl — embedding_dim_mismatch soft-failure', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns structured soft-failure when embedding length is wrong — store never sees it', async () => {
    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall(
        'search_packs_nl',
        { projectSlug: h.projectSlug, query: 'x', embedding: [0.1, 0.2, 0.3] },
        'sess_snl',
      ),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('embedding_dim_mismatch');
    if (out.error !== 'embedding_dim_mismatch') return;
    expect(out.expected).toBe(EMBEDDING_DIM);
    expect(out.got).toBe(3);
    expect(out.howToFix).toMatch(/384|NL Assembly/);
  });

  it('returns embedding_dim_mismatch for a too-long embedding too', async () => {
    const registry = buildRegistry(h);
    const tooLong = new Array(EMBEDDING_DIM + 50).fill(0.1);
    const out = unwrap(
      await registry.handleCall(
        'search_packs_nl',
        { projectSlug: h.projectSlug, query: 'x', embedding: tooLong },
        'sess_snl',
      ),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('embedding_dim_mismatch');
    if (out.error !== 'embedding_dim_mismatch') return;
    expect(out.got).toBe(EMBEDDING_DIM + 50);
  });
});

// ---------------------------------------------------------------------------
// LIKE fallback when no embedding supplied
// ---------------------------------------------------------------------------

describe('search_packs_nl — LIKE fallback when no embedding supplied', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns ok:true + notice:no_embeddings_yet + howToFix + matching packs', async () => {
    // Seed 2 runs + 2 context packs; one matches "auth" in title, one doesn't.
    await seedRun(h.handle, 'run_fb_1', h.projectId, 'sess_fb_1');
    await seedRun(h.handle, 'run_fb_2', h.projectId, 'sess_fb_2');
    await h.deps.contextPack.write(
      {
        runId: 'run_fb_1',
        projectId: h.projectId,
        title: 'Auth Overhaul',
        content: 'Replaced token rotation logic.',
      },
      null,
    );
    await h.deps.contextPack.write(
      {
        runId: 'run_fb_2',
        projectId: h.projectId,
        title: 'Landing Page',
        content: 'Fixed hero copy typos.',
      },
      null,
    );

    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall('search_packs_nl', { projectSlug: h.projectSlug, query: 'auth' }, 'sess_snl'),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notice).toBe('no_embeddings_yet');
    expect(out.howToFix).toBeDefined();
    expect(out.packs).toHaveLength(1);
    expect(out.packs[0]?.title).toBe('Auth Overhaul');
    expect(out.packs[0]?.score).toBeNull();
    expect(out.packs[0]?.runId).toBe('run_fb_1');
  });

  it('returns ok:true + empty packs when nothing matches the query (NOT a soft-failure)', async () => {
    await seedRun(h.handle, 'run_empty', h.projectId, 'sess_empty');
    await h.deps.contextPack.write(
      { runId: 'run_empty', projectId: h.projectId, title: 'One Thing', content: 'Body.' },
      null,
    );
    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall(
        'search_packs_nl',
        { projectSlug: h.projectSlug, query: 'nothingmatchesthisquerywhatsoever' },
        'sess_snl',
      ),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packs).toEqual([]);
    expect(out.notice).toBe('no_embeddings_yet');
  });

  it('LIKE match is case-insensitive across title + content_excerpt', async () => {
    await seedRun(h.handle, 'run_ci_1', h.projectId, 'sess_ci_1');
    await h.deps.contextPack.write(
      { runId: 'run_ci_1', projectId: h.projectId, title: 'Feature X', content: 'Implements DATABASE sync.' },
      null,
    );
    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall('search_packs_nl', { projectSlug: h.projectSlug, query: 'database' }, 'sess_snl'),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packs).toHaveLength(1);
    expect(out.packs[0]?.excerpt).toMatch(/DATABASE/);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedRun(h.handle, `run_lim_${i}`, h.projectId, `sess_lim_${i}`);
      await h.deps.contextPack.write(
        {
          runId: `run_lim_${i}`,
          projectId: h.projectId,
          title: `Title ${i}`,
          content: `matching body ${i}`,
        },
        null,
      );
    }
    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall(
        'search_packs_nl',
        { projectSlug: h.projectSlug, query: 'matching', limit: 2 },
        'sess_snl',
      ),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packs).toHaveLength(2);
  });

  it('scopes to the project (packs from other projects are not returned)', async () => {
    const otherProjectId = 'proj_other';
    h.handle.raw
      .prepare(`INSERT INTO projects (id, slug, org_id, name) VALUES (?, ?, ?, ?)`)
      .run(otherProjectId, 'slug-other', 'org_test', 'other project');
    await seedRun(h.handle, 'run_own', h.projectId, 'sess_own');
    await seedRun(h.handle, 'run_other', otherProjectId, 'sess_other');
    await h.deps.contextPack.write(
      { runId: 'run_own', projectId: h.projectId, title: 'Own Pack', content: 'shared keyword here' },
      null,
    );
    await h.deps.contextPack.write(
      { runId: 'run_other', projectId: otherProjectId, title: 'Other Pack', content: 'shared keyword here' },
      null,
    );
    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall('search_packs_nl', { projectSlug: h.projectSlug, query: 'shared keyword' }, 'sess_snl'),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packs).toHaveLength(1);
    expect(out.packs[0]?.title).toBe('Own Pack');
  });
});

// ---------------------------------------------------------------------------
// Semantic path — real vec0 KNN with JOIN back to context_packs metadata
// ---------------------------------------------------------------------------

describe('search_packs_nl — semantic path with 384-dim embedding', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await openHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns semantic hits ordered by cosine distance with score = distance (no notice)', async () => {
    await seedRun(h.handle, 'run_sem_1', h.projectId, 'sess_sem_1');
    await seedRun(h.handle, 'run_sem_2', h.projectId, 'sess_sem_2');
    await seedRun(h.handle, 'run_sem_3', h.projectId, 'sess_sem_3');
    // Three packs with unit-vector embeddings on different axes.
    await h.deps.contextPack.write(
      { runId: 'run_sem_1', projectId: h.projectId, title: 'Axis 0', content: 'body 1' },
      makeUnitVector(0),
    );
    await h.deps.contextPack.write(
      { runId: 'run_sem_2', projectId: h.projectId, title: 'Axis 10', content: 'body 2' },
      makeUnitVector(10),
    );
    await h.deps.contextPack.write(
      { runId: 'run_sem_3', projectId: h.projectId, title: 'Axis 20', content: 'body 3' },
      makeUnitVector(20),
    );

    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall(
        'search_packs_nl',
        { projectSlug: h.projectSlug, query: 'unused when embedding supplied', embedding: makeUnitArray(0), limit: 3 },
        'sess_snl',
      ),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.notice).toBeUndefined();
    expect(out.howToFix).toBeUndefined();
    expect(out.packs).toHaveLength(3);
    // First hit is the axis-0 pack (distance 0); the rest have distance 1 (orthogonal).
    expect(out.packs[0]?.title).toBe('Axis 0');
    expect(out.packs[0]?.score).toBeLessThan(out.packs[1]?.score ?? Number.POSITIVE_INFINITY);
    expect(out.packs[0]?.runId).toBe('run_sem_1');
  });

  it('returns empty packs (ok:true, no notice) when no semantic matches exist for the project', async () => {
    // No packs in this project; semantic search returns [].
    const registry = buildRegistry(h);
    const out = unwrap(
      await registry.handleCall(
        'search_packs_nl',
        { projectSlug: h.projectSlug, query: 'anything', embedding: makeUnitArray(0) },
        'sess_snl',
      ),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packs).toEqual([]);
    expect(out.notice).toBeUndefined();
  });
});
