import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureGlobalProject, migrateSqlite } from '@contextos/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCheckContext } from '../../../src/doctor/context.js';
import { ALL_CHECKS } from '../../../src/doctor/registry.js';
import { runChecks } from '../../../src/doctor/run.js';
import { openLocalDb } from '../../../src/lib/open-local-db.js';

/**
 * Drives the full 20-check registry against a controlled tmp `~/.contextos/`
 * fixture. This is the slice's "real test" — every check executes against
 * real fs + real SQLite (with migrations applied + F7 sentinel seeded).
 */
describe('doctor — full registry against a controlled fixture', () => {
  let home: string;
  let cwd: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'contextos-doctor-'));
    cwd = await mkdtemp(join(tmpdir(), 'contextos-cwd-'));
    await mkdir(join(home, 'logs'), { recursive: true });
    await mkdir(join(home, 'pids'), { recursive: true });
    await chmod(home, 0o700);
  });

  afterEach(async () => {
    // tmp dirs auto-cleaned by OS, but we don't need to leak DB handles
  });

  it('greenfield (no data.db, no .contextos.json) — checks 3,4,5,12 land as red/yellow/skipped per spec', async () => {
    const ctx = buildCheckContext({
      contextosHomeOverride: home,
      cwd,
      env: { LOCAL_HOOK_SECRET: 'a'.repeat(64) },
      timeoutMs: 800,
    });
    const report = await runChecks(ALL_CHECKS, ctx);
    const get = (id: number) => report.checks.find((c) => c.id === id);

    // Node ≥22 (running tests on 22+ — green). data.db missing → red on 3, skipped on 4 + 5 + 12.
    expect(get(1)?.status).toBe('green');
    expect(get(3)?.status).toBe('red');
    expect(get(4)?.status).toBe('skipped');
    expect(get(5)?.status).toBe('skipped');
    expect(get(12)?.status).toBe('yellow'); // .contextos.json missing → yellow w/ remediation
    expect(get(13)?.status).toBe('yellow'); // permanent-yellow placeholder
    // 17/18 may be green (port free) or yellow (in use); both are acceptable in CI runners.
    expect(['green', 'yellow']).toContain(get(17)?.status);
    expect(['green', 'yellow']).toContain(get(18)?.status);
  });

  it('initialised home with migrations applied + F7 sentinel — checks 3,4,5 green, 6/7 green', async () => {
    // Apply migrations and seed __global__ project so checks 3-5 are green.
    const dataDb = join(home, 'data.db');
    const handle = await openLocalDb(dataDb, { loadVecExtension: true });
    migrateSqlite(handle.db);
    await ensureGlobalProject(handle);
    handle.close();

    const ctx = buildCheckContext({
      contextosHomeOverride: home,
      cwd,
      env: { LOCAL_HOOK_SECRET: 'a'.repeat(64) },
      timeoutMs: 800,
    });
    const report = await runChecks(ALL_CHECKS, ctx);
    const get = (id: number) => report.checks.find((c) => c.id === id);

    expect(get(3)?.status).toBe('green');
    expect(get(4)?.status).toBe('green');
    expect(get(5)?.status).toBe('green');
    // No policy_decisions rows yet — check 6 is green (nothing to validate).
    expect(get(6)?.status).toBe('green');
    // No run_events orphans (no rows at all) — check 7 is green.
    expect(get(7)?.status).toBe('green');
    // Bridge runId logs check — no log files → skipped.
    expect(get(8)?.status).toBe('skipped');
    // .contextos.json absent → yellow.
    expect(get(12)?.status).toBe('yellow');
    expect(get(20)?.status).toBe('green'); // LOCAL_HOOK_SECRET via env
  });

  it('with .contextos.json pointing at a registered project — check 12 green', async () => {
    const dataDb = join(home, 'data.db');
    const handle = await openLocalDb(dataDb, { loadVecExtension: true });
    migrateSqlite(handle.db);
    await ensureGlobalProject(handle);
    // Add a registered project for the test slug.
    const projectId = 'proj_test_001';
    handle.raw
      .prepare(
        `INSERT INTO projects (id, slug, org_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(projectId, 'doctortest', 'org_test', 'doctortest');
    handle.close();
    await writeFile(join(cwd, '.contextos.json'), JSON.stringify({ projectSlug: 'doctortest' }));

    const ctx = buildCheckContext({
      contextosHomeOverride: home,
      cwd,
      env: { LOCAL_HOOK_SECRET: 'a'.repeat(64) },
      timeoutMs: 800,
    });
    const report = await runChecks(ALL_CHECKS, ctx);
    const get = (id: number) => report.checks.find((c) => c.id === id);
    expect(get(12)?.status).toBe('green');
  });

  it('check 7 surfaces a NULL run_events.run_id as RED (F8 invariant; load-bearing doctor)', async () => {
    const dataDb = join(home, 'data.db');
    const handle = await openLocalDb(dataDb, { loadVecExtension: true });
    migrateSqlite(handle.db);
    await ensureGlobalProject(handle);

    // Seed a runs row, then a single run_events row with NULL run_id.
    handle.raw
      .prepare(
        `INSERT INTO runs (id, project_id, session_id, agent_type, mode, status, started_at)
         VALUES (?, '__global__', 'sess-orphan-test', 'claude_code', 'solo', 'in_progress', unixepoch())`,
      )
      .run('run-orphan-test');
    handle.raw
      .prepare(
        `INSERT INTO run_events (id, run_id, phase, tool_name, tool_use_id, tool_input)
         VALUES (?, NULL, 'PreToolUse', 'edit_file', ?, '{}')`,
      )
      .run('ev-orphan-test', 'tu_orphan_test');
    handle.close();

    const ctx = buildCheckContext({
      contextosHomeOverride: home,
      cwd,
      env: { LOCAL_HOOK_SECRET: 'a'.repeat(64) },
      timeoutMs: 800,
    });
    const report = await runChecks(ALL_CHECKS, ctx);
    const get = (id: number) => report.checks.find((c) => c.id === id);
    expect(get(7)?.status).toBe('red');
    expect(get(7)?.detail).toMatch(/NULL run_id/);
  });

  it('check 6 surfaces F14 legacy 3-segment rows as yellow', async () => {
    const dataDb = join(home, 'data.db');
    const handle = await openLocalDb(dataDb, { loadVecExtension: true });
    migrateSqlite(handle.db);
    await ensureGlobalProject(handle);

    // Insert two policy_decisions rows: one F14 4-segment, one legacy 3-segment.
    const insert = handle.raw.prepare(
      `INSERT INTO policy_decisions
         (id, idempotency_key, agent_type, project_id, session_id, event_type, tool_name,
          tool_input_snapshot, permission_decision, reason, created_at)
       VALUES (?, ?, 'claude_code', '__global__', 'sess1', 'PreToolUse', 'write_file',
          '{}', 'allow', 'no_rule_matched', unixepoch())`,
    );
    insert.run('pd_legacy_001', 'pd:sess1:write_file:PreToolUse');
    insert.run('pd_f14_001', 'pd:sess1:tu_abc:write_file:PreToolUse');
    handle.close();

    const ctx = buildCheckContext({
      contextosHomeOverride: home,
      cwd,
      env: { LOCAL_HOOK_SECRET: 'a'.repeat(64) },
      timeoutMs: 800,
    });
    const report = await runChecks(ALL_CHECKS, ctx);
    const get = (id: number) => report.checks.find((c) => c.id === id);
    expect(get(6)?.status).toBe('yellow');
    expect(get(6)?.detail).toMatch(/pre-F14/);
  });
});
