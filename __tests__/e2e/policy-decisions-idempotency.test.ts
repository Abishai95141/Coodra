import { randomUUID } from 'node:crypto';

import { postgresSchema } from '@contextos/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type BootHandle, bootForE2E, buildE2eEnv } from './_helpers/boot.js';
import { openPostgresHandle, type PostgresHandle } from './_helpers/postgres.js';

/**
 * Policy decisions idempotency under retries (S17).
 *
 * SCENARIO: dispatch `check_policy` 10× concurrently with the same
 * `(sessionId, toolName, eventType)` triple and the same projectSlug.
 * The S14 contract says exactly ONE row should land in
 * `policy_decisions` (the UNIQUE index on `idempotency_key` +
 * `ON CONFLICT DO NOTHING` enforces this). All 10 responses must be
 * structurally identical.
 *
 * Why testcontainers Postgres: sqlite serialises writes per-file, so
 * "10 concurrent inserts" on sqlite isn't actually concurrent at the
 * row-level. Postgres + a real connection pool exercises the actual
 * race condition the production deployment will see.
 */

interface Harness {
  readonly pg: PostgresHandle;
  readonly boot: BootHandle;
  readonly client: Client;
  readonly projectId: string;
  readonly projectSlug: string;
}

let h: Harness;

beforeAll(async () => {
  const pg = await openPostgresHandle();
  // Seed a project so check_policy resolves the slug → projectId path.
  const projectId = `proj_${randomUUID()}`;
  const projectSlug = `slug-${projectId.slice(0, 12)}`;
  await pg.handle.db
    .insert(postgresSchema.projects)
    .values({ id: projectId, slug: projectSlug, orgId: 'org_e2e', name: 'idem-e2e' });

  const env = buildE2eEnv({ CONTEXTOS_MODE: 'team', CLERK_SECRET_KEY: 'sk_test_replace_me' });
  const boot = await bootForE2E({ db: pg.handle, env, withHttp: true });
  if (!boot.http) throw new Error('expected HTTP transport');

  const transport = new StreamableHTTPClientTransport(new URL(`${boot.http.url}/mcp`));
  const client = new Client({ name: 'idem-e2e', version: '0.0.0-e2e' }, { capabilities: {} });
  await client.connect(transport);

  h = { pg, boot, client, projectId, projectSlug };
}, 180_000);

afterAll(async () => {
  await h.client.close().catch(() => {});
  await h.boot.close();
  await h.pg.close();
}, 60_000);

describe('e2e — policy_decisions idempotency under concurrent retries', () => {
  it('10 concurrent check_policy calls with same (sessionId, toolName, eventType) → exactly 1 row + identical responses', async () => {
    const sessionId = 'sess_e2e_idem';
    const toolName = 'Write';
    const eventType = 'PreToolUse' as const;
    const args = {
      projectSlug: h.projectSlug,
      sessionId,
      agentType: 'claude_code',
      eventType,
      toolName,
      toolInput: { file_path: '/tmp/x' },
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => h.client.callTool({ name: 'check_policy', arguments: args })),
    );
    expect(responses).toHaveLength(10);

    // Every response should structurally match — same permissionDecision,
    // same reason enum, same matchedRuleId. The handler's setImmediate
    // audit dispatch races to the DB; the inner check_policy decision
    // is deterministic (no rules seeded → 'no_rule_matched').
    const decoded = responses.map((r) => {
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? '{}';
      return JSON.parse(text) as {
        ok: boolean;
        data?: { permissionDecision: string; reason: string; failOpen: boolean };
      };
    });
    for (const d of decoded) {
      expect(d.ok).toBe(true);
      expect(d.data?.permissionDecision).toBe('allow');
      expect(d.data?.reason).toBe('no_rule_matched');
      expect(d.data?.failOpen).toBe(false);
    }

    // Drain the setImmediate queue across all 10 dispatches. Two ticks
    // give every dispatched insert + ON CONFLICT a chance to land.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rows = await h.pg.handle.db
      .select()
      .from(postgresSchema.policyDecisions)
      .where(eq(postgresSchema.policyDecisions.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBe(`pd:${sessionId}:${toolName}:${eventType}`);
    expect(rows[0]?.permissionDecision).toBe('allow');
    expect(rows[0]?.reason).toBe('no_rule_matched');
  });
});
