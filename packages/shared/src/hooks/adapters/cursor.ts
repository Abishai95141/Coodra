import type { HookEvent } from '../event.js';
import { normalizeSessionId } from '../normalize-session-id.js';
import type { CursorHookPayload } from '../payloads/cursor.js';

/**
 * Cursor → HookEvent normalizer per ADR-009.
 *
 * Cursor's payload is closer in shape to Claude Code's than to
 * Windsurf's: a `conversation_id` (session-equivalent), an explicit
 * `event_type` lifecycle tag, and tool-call fields. Field rename:
 * `conversation_id` → `sessionId` after `normalizeSessionId`.
 */

const PHASE_MAP: Readonly<Record<CursorHookPayload['event_type'], HookEvent['eventPhase']>> = {
  pre_tool_use: 'pre',
  post_tool_use: 'post',
  session_start: 'session_start',
  session_end: 'session_end',
};

function extractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ['file_path', 'filePath', 'path']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export interface AdaptCursorOptions {
  /** Clock injection for deterministic tests. */
  readonly now?: () => Date;
}

export function adaptCursor(payload: CursorHookPayload, options: AdaptCursorOptions = {}): HookEvent {
  const now = options.now ?? (() => new Date());
  const phase = PHASE_MAP[payload.event_type];

  const event: HookEvent = {
    agentType: 'cursor',
    eventPhase: phase,
    sessionId: normalizeSessionId(payload.conversation_id),
    toolName: payload.tool_name ?? '',
    toolInput: payload.tool_input,
    rawAt: now().toISOString(),
  };

  if (payload.tool_call_id !== undefined) {
    (event as { turnId?: string }).turnId = payload.tool_call_id;
  }
  const filePath = extractFilePath(payload.tool_input);
  if (filePath !== undefined) {
    (event as { filePath?: string }).filePath = filePath;
  }
  if (payload.cwd !== undefined) {
    (event as { cwd?: string }).cwd = payload.cwd;
  }
  return event;
}
