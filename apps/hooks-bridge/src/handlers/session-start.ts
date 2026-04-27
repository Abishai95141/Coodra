import type { DbHandle } from '@contextos/db';
import { createLogger } from '@contextos/shared';
import type { HookEvent } from '@contextos/shared/hooks';

import type { HookDispatchResult } from '../app.js';
import type { ProjectSlugResolver } from '../lib/resolve-project-slug.js';
import type { RunRecorder } from '../lib/run-recorder.js';

/**
 * `apps/hooks-bridge/src/handlers/session-start` — opens the runs row.
 * Returns allow synchronously; the audit write (INSERT ... ON CONFLICT
 * DO NOTHING) is fire-and-forget per the §16 pattern 3 outbox.
 */

const sessionStartLogger = createLogger('hooks-bridge.session-start');

export interface CreateSessionStartHandlerDeps {
  readonly runRecorder: RunRecorder;
  readonly projectSlugResolver: ProjectSlugResolver;
  readonly db: DbHandle;
  readonly mode: 'solo' | 'team';
}

export type SessionStartHandler = (event: HookEvent) => Promise<HookDispatchResult>;

export function createSessionStartHandler(deps: CreateSessionStartHandlerDeps): SessionStartHandler {
  return async function handleSessionStart(event) {
    if (event.eventPhase !== 'session_start') {
      sessionStartLogger.warn(
        { event: 'event_phase_mismatch', sessionId: event.sessionId, phase: event.eventPhase },
        'session-start handler called for non-session_start event; allowing',
      );
      return { permissionDecision: 'allow', permissionDecisionReason: 'event_phase_mismatch' };
    }
    const { projectId } = await deps.projectSlugResolver.resolve(event.cwd, deps.db);
    deps.runRecorder.recordSessionStart({ event, projectId, mode: deps.mode });
    sessionStartLogger.info(
      {
        event: 'session_start_recorded',
        sessionId: event.sessionId,
        agentType: event.agentType,
        ...(projectId !== undefined ? { projectId } : {}),
      },
      'SessionStart audit scheduled',
    );
    return { permissionDecision: 'allow' };
  };
}
