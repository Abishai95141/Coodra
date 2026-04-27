import type { HookEvent } from '../event.js';
import { normalizeSessionId } from '../normalize-session-id.js';
import type { WindsurfHookPayload } from '../payloads/windsurf.js';

/**
 * Windsurf → HookEvent normalizer per `system-architecture.md` §3.3
 * mapping table.
 *
 * Three Windsurf events are intentionally unmapped (`post_read_code`,
 * `post_user_prompt`, `pre_cascade_response`) because they add noise
 * without changing the run record. The adapter returns `null` for
 * those — the hooks-bridge route should treat null as "ack but
 * don't process" and return `{ decision: 'allow' }`.
 *
 * Tool-name normalization: Windsurf's `agent_action_name` is the
 * lifecycle marker (pre_write_code), not the tool name. Map it to
 * the same vocabulary Claude Code uses (Write, Edit, Bash, Read,
 * UserPrompt, MCP) so policy rules don't need per-agent matching.
 */

const PHASE_MAP: Readonly<Record<WindsurfHookPayload['agent_action_name'], HookEvent['eventPhase'] | null>> = {
  pre_write_code: 'pre',
  pre_run_command: 'pre',
  pre_mcp_tool_use: 'pre',
  pre_read_code: 'pre',
  pre_user_prompt: 'user_prompt',
  post_write_code: 'post',
  post_run_command: 'post',
  post_mcp_tool_use: 'post',
  post_cascade_response: 'session_end',
  // Unmapped — adapter returns null for these.
  post_read_code: null,
  post_user_prompt: null,
  pre_cascade_response: null,
};

const TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  pre_write_code: 'Write',
  post_write_code: 'Write',
  pre_run_command: 'Bash',
  post_run_command: 'Bash',
  pre_read_code: 'Read',
  post_read_code: 'Read',
  pre_mcp_tool_use: 'MCP',
  post_mcp_tool_use: 'MCP',
  pre_user_prompt: 'user_prompt',
  post_user_prompt: 'user_prompt',
  post_cascade_response: '',
  pre_cascade_response: '',
};

function extractFilePath(toolInfo: unknown): string | undefined {
  if (!toolInfo || typeof toolInfo !== 'object') return undefined;
  const record = toolInfo as Record<string, unknown>;
  for (const key of ['file_path', 'filePath', 'path']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export interface AdaptWindsurfOptions {
  /** Clock injection for deterministic tests. */
  readonly now?: () => Date;
}

/**
 * Returns a HookEvent for the 9 mapped events, or `null` for the 3
 * unmapped ones. Callers (the hooks-bridge route) should ack the
 * payload with `{ decision: 'allow' }` when null is returned.
 */
export function adaptWindsurf(payload: WindsurfHookPayload, options: AdaptWindsurfOptions = {}): HookEvent | null {
  const now = options.now ?? (() => new Date());
  const phase = PHASE_MAP[payload.agent_action_name];
  if (phase === null) return null;

  const toolName = TOOL_NAME_MAP[payload.agent_action_name] ?? '';

  const event: HookEvent = {
    agentType: 'windsurf',
    eventPhase: phase,
    sessionId: normalizeSessionId(payload.trajectory_id),
    toolName,
    toolInput: payload.tool_info,
    rawAt: now().toISOString(),
  };

  if (payload.execution_id !== undefined) {
    (event as { turnId?: string }).turnId = payload.execution_id;
  }
  const filePath = extractFilePath(payload.tool_info);
  if (filePath !== undefined) {
    (event as { filePath?: string }).filePath = filePath;
  }
  return event;
}
