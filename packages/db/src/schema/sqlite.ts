import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema — solo-mode primary store (`system-architecture.md` §4.1).
 *
 * Ten tables total after Module 02:
 *   - Module-01 core (append-only where noted in §4.3):
 *     projects, runs, run_events, context_packs, pending_jobs
 *   - Module-02 additions:
 *     policies, policy_rules, policy_decisions (append-only),
 *     feature_packs, decisions (append-only, idempotent on
 *     `dec:{runId}:{sha256(description)}`)
 *
 * Every timestamp column uses `integer({ mode: 'timestamp' })` so Drizzle
 * returns `Date` instances; the underlying storage is Unix seconds. Every
 * boolean column uses `integer({ mode: 'boolean' })` which stores 0/1 but
 * maps to JS boolean at the ORM layer; this keeps the schema-parity test
 * green against Postgres's native `boolean` type (Drizzle reports the same
 * `dataType: 'boolean'` for both).
 *
 * `context_packs.summary_embedding` is `text` here — the sqlite-vec
 * virtual table `context_packs_vec` shipped in Module 02 holds the real
 * vector and is created by a hand-appended SQL block in migration 0001
 * (sha256-locked per `packages/db/migrations.lock.json`). The Postgres
 * dialect keeps `vector(384)` on the main table with an HNSW index.
 * The schema-parity test allows this single intentional dialect drift.
 *
 * `context_packs.content_excerpt` is populated at save time by
 * `save_context_pack` with the first 500 Unicode code points of
 * `content` (trailing whitespace trimmed). Powers the `search_packs_nl`
 * LIKE fallback when `summary_embedding` is still NULL (pre-Module-05).
 */

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id').notNull(),
    agentType: text('agent_type').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('in_progress'),
    issueRef: text('issue_ref'),
    prRef: text('pr_ref'),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
  },
  (t) => [uniqueIndex('runs_project_session_idx').on(t.projectId, t.sessionId), index('runs_status_idx').on(t.status)],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: text('id').primaryKey(),
    // run_id is nullable + ON DELETE SET NULL: the `RunRecorder.record()`
    // contract (see apps/mcp-server/src/framework/tool-context.ts) accepts
    // `runId: string | null` so PreToolUse events that fire before a
    // `runs` row exists still land in the trace (system-architecture.md
    // §4.3 rationale). Widened from NOT NULL in Module-02 migration 0002
    // — see context_memory/decisions-log.md 2026-04-24.
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    phase: text('phase').notNull(),
    toolName: text('tool_name').notNull(),
    toolUseId: text('tool_use_id').notNull(),
    toolInput: text('tool_input').notNull(),
    outcome: text('outcome'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('run_events_run_created_idx').on(t.runId, t.createdAt)],
);

export const contextPacks = sqliteTable(
  'context_packs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    content: text('content').notNull(),
    contentExcerpt: text('content_excerpt').notNull().default(''),
    summaryEmbedding: text('summary_embedding'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('context_packs_run_idx').on(t.runId),
    index('context_packs_project_created_idx').on(t.projectId, t.createdAt),
  ],
);

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

export const policies = sqliteTable('policies', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const policyRules = sqliteTable(
  'policy_rules',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id')
      .notNull()
      .references(() => policies.id),
    priority: integer('priority').notNull(),
    matchEventType: text('match_event_type').notNull(),
    matchToolName: text('match_tool_name').notNull(),
    matchPathGlob: text('match_path_glob'),
    matchAgentType: text('match_agent_type'),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('policy_rules_policy_priority_idx').on(t.policyId, t.priority)],
);

export const policyDecisions = sqliteTable(
  'policy_decisions',
  {
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    runId: text('run_id').references(() => runs.id),
    sessionId: text('session_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    agentType: text('agent_type').notNull(),
    eventType: text('event_type').notNull(),
    toolName: text('tool_name').notNull(),
    toolInputSnapshot: text('tool_input_snapshot').notNull(),
    permissionDecision: text('permission_decision').notNull(),
    matchedRuleId: text('matched_rule_id').references(() => policyRules.id),
    reason: text('reason').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('policy_decisions_session_idx').on(t.sessionId, t.createdAt)],
);

export const featurePacks = sqliteTable('feature_packs', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  parentSlug: text('parent_slug'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  checksum: text('checksum').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const decisions = sqliteTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    // idempotency_key = `dec:{runId}:{sha256(description).slice(0,32)}`. Two
    // calls with the same runId + identical description collide on this
    // unique index and the second returns the first row's id — see
    // `apps/mcp-server/src/tools/record-decision/handler.ts`.
    idempotencyKey: text('idempotency_key').notNull().unique(),
    // run_id is nullable + ON DELETE SET NULL so decisions survive the
    // deletion of their originating run (decisions are permanent history;
    // parallels the run_events widening in migration 0002).
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    rationale: text('rationale').notNull(),
    // JSON-encoded string[] ; NULL is treated as [] by the handler.
    // Stored as text on both dialects for parity — the handler does
    // JSON.parse/stringify, so Postgres gains nothing from JSONB here.
    alternatives: text('alternatives'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('decisions_run_created_idx').on(t.runId, t.createdAt)],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunEvent = typeof runEvents.$inferSelect;
export type NewRunEvent = typeof runEvents.$inferInsert;
export type ContextPack = typeof contextPacks.$inferSelect;
export type NewContextPack = typeof contextPacks.$inferInsert;
export type PendingJob = typeof pendingJobs.$inferSelect;
export type NewPendingJob = typeof pendingJobs.$inferInsert;
export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;
export type PolicyRule = typeof policyRules.$inferSelect;
export type NewPolicyRule = typeof policyRules.$inferInsert;
export type PolicyDecision = typeof policyDecisions.$inferSelect;
export type NewPolicyDecision = typeof policyDecisions.$inferInsert;
export type FeaturePack = typeof featurePacks.$inferSelect;
export type NewFeaturePack = typeof featurePacks.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
