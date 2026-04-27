# Module 03.1 — Durable Audit Outbox — Spec (placeholder)

> **Status:** placeholder (2026-04-27). Full spec to be written when scheduled.
> **Depends on:** Module 03 (Hooks Bridge, merged), Module 02 (MCP Server, merged).
> **Blocks:** Module 04 (Web App). Module 04's audit-trail UI assumes `policy_decisions` and `run_events` are durable across crashes; landing 04 first would lock in a contract this module is meant to fix.
> **Source of truth:** `system-architecture.md` §4.3 (idempotency keys + append-only tables), §16 pattern 3 (transactional outbox), §16 pattern 19 (durable audit log). The `pending_jobs` table already exists in the schema (`packages/db/src/schema/sqlite.ts`, `packages/db/src/schema/postgres.ts`) as the design seed.

## 1. The problem

Today, every audit row written by the bridge — `run_events` (PostToolUse, UserPromptSubmit), `policy_decisions` (PreToolUse), and `runs` lifecycle UPDATEs — is dispatched via `setImmediate(...)` after the HTTP response returns. The dispatch is in-process and not durable:

- **SIGTERM mid-PreToolUse**: the policy decision returns to the agent (200 OK), the agent proceeds, but the bridge's audit-row INSERT is still queued in the event loop. If the process exits before the INSERT fires (kill, OOM, panic, deploy restart), the row is **lost forever**. The architecture's append-only invariant assumes the row landed; SOC2 / NHI governance reads will silently miss the decision.
- **Same class of issue** for PostToolUse and UserPromptSubmit (`run_events`), and for SessionStart / Stop (`runs` open/close).
- **MCP `check_policy` has the same shape** — the audit write fires via `setImmediate(...)` in `apps/mcp-server/src/tools/check-policy/handler.ts:166`. Same race; same loss profile.

This was tolerable through M01–M03 because:

- Policy decisions are advisory; the agent already saw the answer.
- Idempotency keys (post-F14: `pd:{sessionId}:{toolUseId}:{toolName}:{eventType}`) protect against duplicates on retry — the agent re-firing the same tool_use_id reproduces the same key, so a missed write can be replayed safely.
- M03's known-issues entry flagged this as "schedule a slice if visibility appears."

It is **not** tolerable past M04 because:

- Module 04's audit-trail UI is the first read surface that surfaces "every decision in this run." Missing rows show up as gaps in the timeline.
- SOC2 readiness — which is the system-architecture.md §22+ governance positioning — assumes the audit log is complete, not best-effort.
- F14's audit-trail-integrity fix would be incomplete if the writes themselves are still racy.

## 2. Design seed

The `pending_jobs` table (in both `packages/db/src/schema/sqlite.ts` and `.../postgres.ts`) was added in M01 as the **transactional outbox seed**:

```typescript
export const pendingJobs = sqliteTable(
  'pending_jobs',
  {
    id: text('id').primaryKey(),
    queue: text('queue').notNull(),
    payload: text('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    status: text('status').notNull().default('pending'),
    runAfter: integer('run_after', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('pending_jobs_poll_idx').on(t.queue, t.status, t.runAfter)],
);
```

The migration is in place; no consumer exists yet. The full spec will write the consumer.

## 3. Sketch (to be expanded)

- **Write path** — `recordPolicyDecision`, `recordPostToolUse`, `recordUserPromptSubmit`, `recordSessionStart`, `recordSessionEnd` all funnel through a `scheduleDurableWrite(jobKind, payload)` helper that writes to `pending_jobs` SYNCHRONOUSLY in the same transaction as the HTTP response is committed. The destination table INSERT is performed by an in-process worker that polls `pending_jobs` (`status='pending' AND run_after <= now()`).
- **Worker** — single in-process worker per service (bridge + mcp-server). On startup, picks up any `status='pending'` rows and replays. On shutdown (SIGTERM), drains in-flight jobs before closing the DB. Failure path: increment `attempts`, set `run_after = now() + backoff(attempts)`, requeue. After N retries (probably 5), mark `status='dead'` and emit a structured-log alert.
- **Idempotency** — the destination INSERT still does `ON CONFLICT (idempotency_key) DO NOTHING` so worker replay after crash is safe. The `pending_jobs.id` is its own key for the queue layer.
- **Local SQLite vs cloud Postgres** — both schemas already have `pending_jobs`. No schema change needed; the worker is the only new code.
- **Testing** — kill -9 mid-Pre + restart + assert `policy_decisions` row landed. (M03's `verify-sigterm-drain.ts` is the existing harness for the graceful-shutdown drain; this module extends it for the kill-9 case.)

## 4. Out of scope (defer to Sync Daemon or M05)

- Cross-machine durable queue (BullMQ in cloud mode). Today both services share the same SQLite, so an in-process worker is sufficient. When Sync Daemon lands and writes can fan out across processes, the queue layer moves to BullMQ + Upstash.
- Backfill of historical NULL `run_id` rows. Out of scope per the M03 verification report.
- Dead-letter queue UI. Out of scope until M04 audit-trail UI is wired.

## 5. Acceptance criteria (placeholder, to be expanded)

1. SIGTERM mid-Pre → restart → `policy_decisions` row lands with the correct idempotency key.
2. `kill -9` mid-Pre → restart → same.
3. Worker drains in-flight `pending_jobs` rows on graceful shutdown.
4. Worker idempotency: replaying a `pending_jobs` row that already INSERTed its destination row is a no-op (the destination's idempotency key dedupes).
5. The five recorder methods (`recordPolicyDecision`, `recordPostToolUse`, `recordUserPromptSubmit`, `recordSessionStart`, `recordSessionEnd`) call `scheduleDurableWrite` instead of `setImmediate`.
6. MCP `check_policy` handler also routes through `scheduleDurableWrite`.
7. M03's existing harnesses (`verify-sigterm-drain.ts`, `verify-phase5-closed-loop.ts`) all still pass.

Full spec, implementation plan, and techstack to be written when this module is scheduled.
