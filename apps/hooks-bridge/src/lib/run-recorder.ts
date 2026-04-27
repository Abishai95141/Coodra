import { createHash, randomUUID } from 'node:crypto';

import { type DbHandle, GLOBAL_PROJECT_ID, lookupRunId, postgresSchema, sqliteSchema } from '@contextos/db';
import { type RecordPolicyDecisionArgs, recordPolicyDecision } from '@contextos/policy';
import { createLogger } from '@contextos/shared';
import type { HookEvent } from '@contextos/shared/hooks';
import { and, eq } from 'drizzle-orm';

/**
 * `apps/hooks-bridge/src/lib/run-recorder` — async + idempotent
 * audit writer for `run_events` and `policy_decisions`.
 *
 * Contract per `system-architecture.md` §4.3 + §16 pattern 3:
 *
 *   - **Sync return.** Both methods schedule the DB write via
 *     `setImmediate(...)` and return synchronously, so the HTTP
 *     response (in solo mode at p95 < 10ms) does not wait on the
 *     DB. If the write fails the failure is WARN-logged with the
 *     full decision context; the agent is unaffected.
 *
 *   - **Idempotency.**
 *       run_events.id = `re_` + sha256(sessionId + '|' + toolUseId + '|' + phase).slice(0, 32)
 *           — primary-key conflict on retry is the dedupe. Architecture
 *           §4.3 specifies the SHAPE `{sessionId}-{toolUseId}-{phase}`
 *           but `@contextos/shared::generateRunEventKey` rejects
 *           hyphens in the segments, and `normalizeSessionId` produces
 *           hyphen-rich session ids by design (it replaces every
 *           Windows-reserved char with `-`). The hash captures the
 *           same uniqueness contract while accepting any input.
 *       policy_decisions.idempotency_key =
 *           pd:{sessionId}:{toolName}:{eventType}
 *           — unique-index conflict on retry is the dedupe.
 *     Both writes use `ON CONFLICT DO NOTHING`.
 *
 *   - **runId is best-effort.** Hooks-bridge does not own the `runs`
 *     table; SessionStart (S9) creates the row. For PostToolUse and
 *     UserPromptSubmit events, the caller (handler) supplies a
 *     resolved `projectId`; the recorder looks up `(project_id,
 *     session_id) → runs.id` via `@contextos/db::lookupRunId`. When
 *     no row matches yet (e.g. a Pre/Post arrives before SessionStart
 *     fired the open) the field stays `null` and the schema's
 *     `ON DELETE SET NULL` (§4.3) keeps the audit row valid. Verification
 *     F8 (2026-04-27) confirmed that the prior implementation hardcoded
 *     `projectSlug=undefined` at the lookup call site, making the field
 *     always `null`; this recorder now threads projectId through every
 *     write path.
 *
 *   - **tool_input snapshot is 8KB-clamped.** Same convention as
 *     mcp-server's policy_decisions writes. Unicode-code-point safe
 *     so a multi-byte char at position 8191 doesn't truncate
 *     mid-character.
 */

const recorderLogger = createLogger('hooks-bridge.run-recorder');

const TOOL_INPUT_MAX_CODE_POINTS = 8 * 1024;

function clampToolInput(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value ?? null);
  } catch {
    serialized = '"<unserialisable>"';
  }
  // Unicode code-point safe: Array.from yields code points, not UTF-16
  // surrogate pairs. A multi-byte char at the boundary stays intact.
  const codePoints = Array.from(serialized);
  if (codePoints.length <= TOOL_INPUT_MAX_CODE_POINTS) return serialized;
  return codePoints.slice(0, TOOL_INPUT_MAX_CODE_POINTS).join('');
}

export interface CreateRunRecorderDeps {
  readonly db: DbHandle;
  /**
   * Test override for setImmediate. Called with an async callback;
   * default fires-and-forgets via setImmediate. A test override may
   * track the returned promise so the suite can drain pending writes
   * before assertions (see `__tests__/integration/handlers/post-tool-
   * use.test.ts`).
   */
  readonly schedule?: (cb: () => Promise<void>) => void;
  /** Test override for UUID minter — defaults to crypto.randomUUID. */
  readonly mintId?: () => string;
}

export interface RunRecorder {
  /**
   * Schedule an async append to `run_events` for a PostToolUse event.
   * Returns synchronously; failure is WARN-logged. Idempotent on
   * retry via the run-event key in the primary-key column.
   *
   * `projectId` (when defined) lets the recorder resolve `runs.id` so
   * the row's `run_id` FK is populated. Pass `undefined` when no
   * project resolves (no `.contextos.json` in cwd) — the row still
   * lands with `run_id: null`.
   */
  recordPostToolUse(event: HookEvent, projectId?: string): void;
  /**
   * Schedule an async append to `run_events` for a UserPromptSubmit
   * event (Claude Code only today). Same idempotency scheme as
   * recordPostToolUse with `phase = 'user_prompt'`. Same `projectId`
   * semantics.
   */
  recordUserPromptSubmit(event: HookEvent, projectId?: string): void;
  /**
   * Schedule an async append to `policy_decisions` for a pre-tool
   * decision. Returns synchronously; failure is WARN-logged.
   * Idempotent on retry via `pd:{sessionId}:{toolName}:{eventType}`.
   * Caller (the pre-tool handler) supplies the resolved projectId
   * + agentType + decision details.
   */
  recordPolicyDecision(args: {
    readonly event: HookEvent;
    readonly projectId: string | undefined;
    readonly decision: 'allow' | 'deny';
    readonly reason: string;
    readonly matchedRuleId: string | null;
  }): void;
  /**
   * Open a `runs` row when SessionStart fires. Skipped when projectId
   * is undefined (FK is NOT NULL). Idempotent — INSERT ON CONFLICT
   * (projectId, sessionId) DO NOTHING.
   */
  recordSessionStart(args: {
    readonly event: HookEvent;
    readonly projectId: string | undefined;
    readonly mode: 'solo' | 'team';
  }): void;
  /**
   * Close a `runs` row when Stop / session_end fires. Idempotent —
   * UPDATE WHERE status != 'completed' guards against double-close.
   */
  recordSessionEnd(args: { readonly event: HookEvent; readonly projectId: string | undefined }): void;
}

export function createRunRecorder(deps: CreateRunRecorderDeps): RunRecorder {
  const schedule = deps.schedule ?? ((cb: () => Promise<void>) => void setImmediate(() => void cb()));
  const mintId = deps.mintId ?? (() => randomUUID());

  /**
   * Hash the (sessionId, turnId, phase) triple as the primary key.
   * Architecture §4.3 specifies `{sessionId}-{toolUseId}-{phase}` but
   * `normalizeSessionId` emits hyphen-rich session ids by design, so
   * the hash captures the uniqueness contract while accepting any
   * input. Prefix `re_` is grep-friendly in audit dumps.
   */
  function buildRunEventId(sessionId: string, turnId: string | undefined, phase: string): string {
    const hash = createHash('sha256');
    hash.update(sessionId);
    hash.update('|');
    hash.update(turnId ?? 'no-turn');
    hash.update('|');
    hash.update(phase);
    return `re_${hash.digest('hex').slice(0, 32)}`;
  }

  /**
   * Shared run_events INSERT path. Both PostToolUse and
   * UserPromptSubmit go through this — same shape, same idempotency
   * scheme, only the `phase` column differs.
   */
  function scheduleRunEventInsert(args: {
    readonly event: HookEvent;
    readonly phase: string;
    readonly logEvent: string;
    readonly projectId: string | undefined;
  }): void {
    const id = buildRunEventId(args.event.sessionId, args.event.turnId, args.phase);
    schedule(async () => {
      try {
        const runId =
          args.projectId !== undefined ? await lookupRunId(deps.db, args.projectId, args.event.sessionId) : null;
        const row = {
          id,
          runId,
          phase: args.phase,
          toolName: args.event.toolName,
          toolUseId: args.event.turnId ?? 'no-turn',
          toolInput: clampToolInput(args.event.toolInput),
          outcome: null,
        };
        if (deps.db.kind === 'sqlite') {
          await deps.db.db
            .insert(sqliteSchema.runEvents)
            .values(row)
            .onConflictDoNothing({ target: sqliteSchema.runEvents.id });
        } else {
          await deps.db.db
            .insert(postgresSchema.runEvents)
            .values(row)
            .onConflictDoNothing({ target: postgresSchema.runEvents.id });
        }
        recorderLogger.debug(
          {
            event: 'run_event_recorded',
            sessionId: args.event.sessionId,
            toolName: args.event.toolName,
            turnId: args.event.turnId,
            phase: args.phase,
            runId: runId ?? 'unresolved',
            projectId: args.projectId ?? 'unresolved',
          },
          'run_events row scheduled+attempted',
        );
      } catch (err) {
        recorderLogger.warn(
          {
            event: args.logEvent,
            sessionId: args.event.sessionId,
            toolName: args.event.toolName,
            turnId: args.event.turnId,
            phase: args.phase,
            projectId: args.projectId ?? 'unresolved',
            err: err instanceof Error ? err.message : String(err),
          },
          'run_events INSERT threw; swallowing (audit-only path)',
        );
      }
    });
  }

  return {
    recordPostToolUse(event, projectId) {
      scheduleRunEventInsert({ event, phase: 'post', logEvent: 'run_event_write_failed', projectId });
    },
    recordUserPromptSubmit(event, projectId) {
      scheduleRunEventInsert({
        event,
        phase: 'user_prompt',
        logEvent: 'user_prompt_write_failed',
        projectId,
      });
    },

    recordSessionStart({ event, projectId, mode }) {
      // F7 closure (2026-04-27): when no .contextos.json resolved a
      // projectId, fall back to the __global__ sentinel so the runs
      // row still lands. This preserves the audit trail for agents
      // operating in unregistered cwds (the alternative — silently
      // skipping — leaves no governance record of the session).
      const effectiveProjectId = projectId ?? GLOBAL_PROJECT_ID;
      const id = mintId();
      const agentType = event.agentType;
      schedule(async () => {
        try {
          if (deps.db.kind === 'sqlite') {
            await deps.db.db
              .insert(sqliteSchema.runs)
              .values({
                id,
                projectId: effectiveProjectId,
                sessionId: event.sessionId,
                agentType,
                mode,
                status: 'in_progress',
              })
              .onConflictDoNothing({
                target: [sqliteSchema.runs.projectId, sqliteSchema.runs.sessionId],
              });
          } else {
            await deps.db.db
              .insert(postgresSchema.runs)
              .values({
                id,
                projectId: effectiveProjectId,
                sessionId: event.sessionId,
                agentType,
                mode,
                status: 'in_progress',
              })
              .onConflictDoNothing({
                target: [postgresSchema.runs.projectId, postgresSchema.runs.sessionId],
              });
          }
        } catch (err) {
          recorderLogger.warn(
            {
              event: 'session_start_write_failed',
              sessionId: event.sessionId,
              projectId: effectiveProjectId,
              fallbackToGlobal: projectId === undefined,
              err: err instanceof Error ? err.message : String(err),
            },
            'runs INSERT (SessionStart) threw; swallowing',
          );
        }
      });
    },

    recordSessionEnd({ event, projectId }) {
      const effectiveProjectId = projectId ?? GLOBAL_PROJECT_ID;
      schedule(async () => {
        try {
          const endedAt = new Date();
          if (deps.db.kind === 'sqlite') {
            await deps.db.db
              .update(sqliteSchema.runs)
              .set({ status: 'completed', endedAt })
              .where(
                and(
                  eq(sqliteSchema.runs.projectId, effectiveProjectId),
                  eq(sqliteSchema.runs.sessionId, event.sessionId),
                ),
              );
          } else {
            await deps.db.db
              .update(postgresSchema.runs)
              .set({ status: 'completed', endedAt })
              .where(
                and(
                  eq(postgresSchema.runs.projectId, effectiveProjectId),
                  eq(postgresSchema.runs.sessionId, event.sessionId),
                ),
              );
          }
        } catch (err) {
          recorderLogger.warn(
            {
              event: 'session_end_write_failed',
              sessionId: event.sessionId,
              projectId: effectiveProjectId,
              fallbackToGlobal: projectId === undefined,
              err: err instanceof Error ? err.message : String(err),
            },
            'runs UPDATE (SessionEnd) threw; swallowing',
          );
        }
      });
    },

    recordPolicyDecision({ event, projectId, decision, reason, matchedRuleId }) {
      // F7 closure (2026-04-27): the prior implementation skipped the
      // audit when projectId was unresolved, leaving no governance
      // record for agents working in unregistered cwds. The
      // __global__ sentinel project (seeded by ensureGlobalProject at
      // boot) is the FK-safe fallback — every decision is now
      // auditable, scoped to either the resolved project or the
      // global sentinel.
      const effectiveProjectId = projectId ?? GLOBAL_PROJECT_ID;

      schedule(async () => {
        // F8 closure (2026-04-27): resolve runId from (projectId,
        // sessionId) instead of hardcoding null. The pre-tool handler
        // already has projectId in scope; the recorder fills in the FK
        // so `policy_decisions.run_id` joins back to `runs.id` for the
        // 'all decisions made within run X' query.
        const resolvedRunId = await lookupRunId(deps.db, effectiveProjectId, event.sessionId);
        const args: RecordPolicyDecisionArgs = {
          projectId: effectiveProjectId,
          sessionId: event.sessionId,
          agentType: event.agentType,
          eventType: 'PreToolUse',
          toolName: event.toolName,
          // F14 closure (2026-04-27 verification): include the agent's
          // per-invocation turnId in the audit-key so distinct Write/
          // Edit/etc invocations within one session each get their own
          // policy_decisions row instead of colliding on the
          // (sessionId, toolName, eventType) triple.
          ...(event.turnId !== undefined ? { toolUseId: event.turnId } : {}),
          toolInputSnapshot: clampToolInput(event.toolInput),
          permissionDecision: decision,
          reason,
          matchedRuleId,
          runId: resolvedRunId,
          mintId,
        };
        try {
          await recordPolicyDecision(deps.db, args);
          recorderLogger.debug(
            {
              event: 'policy_decision_recorded',
              sessionId: event.sessionId,
              toolName: event.toolName,
              eventType: 'PreToolUse',
              matchedRuleId,
              runId: resolvedRunId ?? 'unresolved',
              projectId,
            },
            'policy_decisions row written',
          );
        } catch (err) {
          recorderLogger.warn(
            {
              event: 'policy_decision_write_failed',
              sessionId: event.sessionId,
              toolName: event.toolName,
              eventType: 'PreToolUse',
              matchedRuleId,
              runId: resolvedRunId ?? 'unresolved',
              projectId,
              err: err instanceof Error ? err.message : String(err),
            },
            'policy_decisions INSERT threw; swallowing (audit-only path)',
          );
        }
      });
    },
  };
}
