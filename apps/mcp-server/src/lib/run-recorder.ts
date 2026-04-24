import { randomUUID } from 'node:crypto';

import { type DbHandle, postgresSchema, sqliteSchema } from '@contextos/db';
import { type Logger, ValidationError } from '@contextos/shared';

import type { RunRecorder } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/run-recorder.ts` — writes `run_events`
 * rows. Scoped to `run_events` only in Module 02 per the frozen
 * `RunRecorder.record()` signature (user directive Q6 + S7c
 * spec/plan reconciliation). `runs` row creation is owned by the
 * `get_run_id` tool (§S8) which threads the full project /
 * agentType / mode context.
 *
 * Async + idempotent:
 *
 *   `record()` builds a row, issues `INSERT ... ON CONFLICT (id)
 *   DO NOTHING` via `setImmediate(...)`. Spec docs §68 +
 *   techstack.md §85 lock this — the durable outbox via
 *   `pending_jobs` is explicitly deferred past Module 03.
 *   Decisions-log 2026-04-24 records the doc reconciliation.
 *
 * Nullable `runId`:
 *
 *   `runs.id` → `run_events.run_id` is nullable + `ON DELETE SET
 *   NULL` after Module-02 migration 0002 (packages/db/drizzle/
 *   {sqlite,postgres}/0002_*.sql). A `record({ runId: null, ... })`
 *   call lands a row with `run_id = NULL`, matching §4.3's
 *   "PreToolUse can fire before a run exists" rationale.
 *
 * Idempotency key:
 *
 *   The frozen interface already carries a structured
 *   `idempotencyKey: IdempotencyKey`. The recorder maps that to the
 *   row's primary key so a retry with the same key is ON CONFLICT
 *   DO NOTHING. This deviates from §4.3's per-row id scheme
 *   (`{sessionId}-{toolUseId}-{phase}`) only in that the row id IS
 *   the idempotency key — tests lock it.
 */

const recorderLogger = createMcpLogger('lib-run-recorder');

export interface CreateRunRecorderDeps {
  readonly db: DbHandle;
  readonly logger?: Logger;
}

function assertArgs(args: Parameters<RunRecorder['record']>[0]): void {
  if (typeof args.toolName !== 'string' || args.toolName.length === 0) {
    throw new ValidationError('run-recorder.record: toolName is required');
  }
  if (args.phase !== 'pre' && args.phase !== 'post') {
    throw new ValidationError(`run-recorder.record: phase must be 'pre' | 'post', got '${String(args.phase)}'`);
  }
  if (typeof args.sessionId !== 'string' || args.sessionId.length === 0) {
    throw new ValidationError('run-recorder.record: sessionId is required');
  }
  if (!args.idempotencyKey || typeof args.idempotencyKey !== 'object' || typeof args.idempotencyKey.key !== 'string') {
    throw new ValidationError('run-recorder.record: idempotencyKey must be a structured IdempotencyKey');
  }
}

export function createRunRecorder(deps: CreateRunRecorderDeps): RunRecorder {
  if (!deps || typeof deps !== 'object') {
    throw new TypeError('createRunRecorder requires an options object');
  }
  if (!deps.db || typeof deps.db !== 'object' || !('kind' in deps.db)) {
    throw new TypeError('createRunRecorder: deps.db must be a DbHandle from @contextos/db');
  }
  const log = deps.logger ?? recorderLogger;

  log.info(
    { event: 'run_recorder_wired', mode: deps.db.kind === 'sqlite' ? 'solo' : 'team' },
    'createRunRecorder: run_events recorder wired (setImmediate + ON CONFLICT DO NOTHING; no durable outbox until Module 03).',
  );

  async function insertRunEvent(args: Parameters<RunRecorder['record']>[0]): Promise<void> {
    // `run_events.id` is a free-form TEXT primary key; we bind the
    // structured idempotency key there. Retries from the same caller
    // surface as `ON CONFLICT DO NOTHING`.
    const eventId = `re_${args.idempotencyKey.key}_${args.phase}`;
    const payload = {
      input: args.input,
      output: args.output ?? null,
      decision: args.decision ?? null,
      reason: args.reason ?? null,
      idempotencyKind: args.idempotencyKey.kind,
    };
    const row = {
      id: eventId,
      runId: args.runId,
      phase: args.phase,
      toolName: args.toolName,
      toolUseId: args.idempotencyKey.key,
      toolInput: JSON.stringify(payload),
      outcome: args.decision ?? null,
    };
    if (deps.db.kind === 'sqlite') {
      await deps.db.db
        .insert(sqliteSchema.runEvents)
        .values(row)
        .onConflictDoNothing({ target: sqliteSchema.runEvents.id });
      return;
    }
    await deps.db.db
      .insert(postgresSchema.runEvents)
      .values(row)
      .onConflictDoNothing({ target: postgresSchema.runEvents.id });
  }

  return {
    async record(args) {
      assertArgs(args);
      // Fire-and-forget on setImmediate so tool call latency is
      // unaffected by run_events I/O. The promise resolves before
      // the insert completes; caller has no way to observe success.
      // Every failure is logged at WARN with the full correlation
      // keys so a noise-baseline lets ops spot drift.
      setImmediate(() => {
        void insertRunEvent(args).catch((err) => {
          log.warn(
            {
              event: 'run_event_write_failed',
              runId: args.runId,
              sessionId: args.sessionId,
              toolName: args.toolName,
              phase: args.phase,
              idempotencyKey: args.idempotencyKey.key,
              err: err instanceof Error ? err.message : String(err),
              // Attach a random id so a concurrent failure burst is
              // distinguishable across tail-lined log lines.
              errorInstance: randomUUID().slice(0, 8),
            },
            'run_events write failed — event lost (no durable outbox before Module 03)',
          );
        });
      });
    },
  };
}
