import { createLogger } from '@contextos/shared';
import type { HookEvent } from '@contextos/shared/hooks';

import type { DispatchHookEvent, HookDispatchResult } from '../app.js';

/**
 * `apps/hooks-bridge/src/lib/dispatch` — composes the per-phase
 * handlers into a single `DispatchHookEvent` callback the Hono routes
 * pass to.
 *
 * Routing rules:
 *   - `eventPhase === 'pre'` → preToolUseHandler (real policy eval).
 *   - everything else → S8/S9/S10 will land RunRecorder + lifecycle
 *     handlers; today returns allow as a stub.
 *
 * Returns null events (Windsurf unmapped) are surfaced from the route
 * directly, not through here. This composer assumes a non-null event.
 */

const dispatchLogger = createLogger('hooks-bridge.dispatch');

export interface ComposeDispatchDeps {
  /** Pre-tool policy handler (S7). */
  readonly preToolUse: (event: HookEvent) => Promise<HookDispatchResult>;
  /** Post-tool RunRecorder handler (S8). */
  readonly postToolUse: (event: HookEvent) => Promise<HookDispatchResult>;
  /** SessionStart handler (S9). */
  readonly sessionStart: (event: HookEvent) => Promise<HookDispatchResult>;
  /** SessionEnd / Stop handler (S9). */
  readonly sessionEnd: (event: HookEvent) => Promise<HookDispatchResult>;
  /** UserPromptSubmit handler (S10). */
  readonly userPromptSubmit: (event: HookEvent) => Promise<HookDispatchResult>;
}

export function composeDispatch(deps: ComposeDispatchDeps): DispatchHookEvent {
  return async function dispatch(event) {
    if (event === null) {
      // Routes handle null events directly; this is a defensive return.
      return { permissionDecision: 'allow', permissionDecisionReason: 'null_event' };
    }
    if (event.eventPhase === 'pre') {
      return deps.preToolUse(event);
    }
    if (event.eventPhase === 'post') {
      return deps.postToolUse(event);
    }
    if (event.eventPhase === 'session_start') {
      return deps.sessionStart(event);
    }
    if (event.eventPhase === 'session_end') {
      return deps.sessionEnd(event);
    }
    if (event.eventPhase === 'user_prompt') {
      return deps.userPromptSubmit(event);
    }
    // Should never reach here — every HookEvent.eventPhase is covered.
    dispatchLogger.warn(
      {
        event: 'dispatch_unknown_phase',
        sessionId: event.sessionId,
        eventPhase: event.eventPhase,
        agentType: event.agentType,
      },
      'unknown event phase; allowing as a defensive fail-open',
    );
    return { permissionDecision: 'allow' };
  };
}
