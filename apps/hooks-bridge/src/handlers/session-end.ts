import type { DbHandle } from '@contextos/db';
import { createLogger } from '@contextos/shared';
import type { HookEvent } from '@contextos/shared/hooks';

import type { HookDispatchResult } from '../app.js';
import type { ProjectSlugResolver } from '../lib/resolve-project-slug.js';
import type { RunRecorder } from '../lib/run-recorder.js';

/**
 * `apps/hooks-bridge/src/handlers/session-end` — closes the runs row.
 * Idempotent: a second Stop/session_end event for the same session is
 * a SQL no-op (UPDATE matches nothing once status='completed').
 */

const sessionEndLogger = createLogger('hooks-bridge.session-end');

export interface CreateSessionEndHandlerDeps {
  readonly runRecorder: RunRecorder;
  readonly projectSlugResolver: ProjectSlugResolver;
  readonly db: DbHandle;
}

export type SessionEndHandler = (event: HookEvent) => Promise<HookDispatchResult>;

export function createSessionEndHandler(deps: CreateSessionEndHandlerDeps): SessionEndHandler {
  return async function handleSessionEnd(event) {
    if (event.eventPhase !== 'session_end') {
      sessionEndLogger.warn(
        { event: 'event_phase_mismatch', sessionId: event.sessionId, phase: event.eventPhase },
        'session-end handler called for non-session_end event; allowing',
      );
      return { permissionDecision: 'allow', permissionDecisionReason: 'event_phase_mismatch' };
    }
    const { projectId } = await deps.projectSlugResolver.resolve(event.cwd, deps.db);
    deps.runRecorder.recordSessionEnd({ event, projectId });
    sessionEndLogger.info(
      {
        event: 'session_end_recorded',
        sessionId: event.sessionId,
        agentType: event.agentType,
        ...(projectId !== undefined ? { projectId } : {}),
      },
      'SessionEnd audit scheduled',
    );
    return { permissionDecision: 'allow' };
  };
}
