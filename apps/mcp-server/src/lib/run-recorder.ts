import type { Logger } from '@contextos/shared';

import type { DbClient, RunRecorder } from '../framework/tool-context.js';
import { NotImplementedError } from './errors.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/run-recorder.ts` — factory for the run /
 * run-event recorder wired into `ToolContext.runRecorder`.
 *
 * S7a contract (user directive Q2): the nullable-`runId` invariant
 * (`system-architecture.md` §4.3 — PreToolUse can fire before a run
 * exists) is handled **inside** the recorder. Callers pass whatever
 * they have: `runId` may be a string or `null`. The recorder's SQL
 * path translates `null` into a literal SQL `NULL`, matching the
 * `runs.id` FK's `ON DELETE SET NULL` column in
 * `packages/db/src/schema/*`. Tool code never branches on `if
 * (runId !== null)` before recording — that would replicate the
 * invariant across N callers and drift.
 *
 * Outbox semantics (S7c, §16 pattern 3): writes go into
 * `pending_jobs` first, drained by an in-process worker. The
 * factory's surface (`record(args)`) does not expose the outbox —
 * callers just get fire-and-forget durability.
 *
 * S7a methods throw `NotImplementedError('run-recorder.record')`.
 */

const runRecorderLogger = createMcpLogger('lib-run-recorder');

export interface CreateRunRecorderDeps {
  readonly db: DbClient;
  readonly logger?: Logger;
}

export function createRunRecorder(deps: CreateRunRecorderDeps): RunRecorder {
  if (!deps?.db) {
    throw new TypeError('createRunRecorder: deps.db is required');
  }
  const log = deps.logger ?? runRecorderLogger;
  log.debug({ event: 'run_recorder_created' }, 'run recorder stub created (S7c will land the real impl)');

  return {
    async record(_args) {
      throw new NotImplementedError('run-recorder.record');
    },
  };
}
