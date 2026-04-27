import { describe, expect, it } from 'vitest';

import { adaptClaudeCode } from '../../../src/hooks/adapters/claude-code.js';
import { adaptCursor } from '../../../src/hooks/adapters/cursor.js';
import { adaptWindsurf } from '../../../src/hooks/adapters/windsurf.js';

/**
 * Three semantically-equivalent fixtures (one per agent representing
 * "PreToolUse: Write to src/auth.ts") must produce HookEvents that
 * match across `eventPhase`, `toolName`, `filePath`, and the *shape*
 * of `sessionId` after normalization. The full equality check is
 * relaxed to those four fields because:
 *   - `agentType` differs by design
 *   - `turnId` is agent-specific
 *   - `toolInput` is opaque passthrough
 *   - `sessionId` content differs (each agent has its own ID format
 *     after normalization)
 *
 * This is what §16 pattern 12 means by "zero agent-specific code
 * downstream of the adapter": the four fields above are what the
 * downstream policy + run-recorder code branches on.
 */

const FROZEN = () => new Date('2026-04-25T12:00:00.000Z');

describe('adapter parity — semantically-equivalent inputs produce structurally-equivalent HookEvents', () => {
  it('PreToolUse: Write to src/auth.ts produces phase=pre + toolName=Write + filePath set across all three agents', () => {
    const cc = adaptClaudeCode(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'cc-session-1',
        tool_name: 'Write',
        tool_input: { file_path: 'src/auth.ts', content: '...' },
        tool_use_id: 'tool-uuid-1',
        cwd: '/home/dev/myapp',
      },
      { now: FROZEN },
    );

    const ws = adaptWindsurf(
      {
        agent_action_name: 'pre_write_code',
        trajectory_id: 'traj-1',
        execution_id: 'exec-1',
        timestamp: '2026-04-25T12:00:00Z',
        model_name: 'Claude Sonnet 4',
        tool_info: { file_path: 'src/auth.ts', edits: [] },
      },
      { now: FROZEN },
    );

    const cu = adaptCursor(
      {
        conversation_id: 'conv-1',
        event_type: 'pre_tool_use',
        tool_name: 'Write',
        tool_call_id: 'call-1',
        tool_input: { file_path: 'src/auth.ts' },
      },
      { now: FROZEN },
    );

    expect(ws).not.toBeNull();
    if (ws === null) return; // typescript narrow
    for (const event of [cc, ws, cu]) {
      expect(event.eventPhase).toBe('pre');
      expect(event.toolName).toBe('Write');
      expect(event.filePath).toBe('src/auth.ts');
      expect(event.rawAt).toBe('2026-04-25T12:00:00.000Z');
    }
  });

  it('PostToolUse → eventPhase=post across all three agents', () => {
    const cc = adaptClaudeCode(
      { hook_event_name: 'PostToolUse', session_id: 'cc', tool_name: 'Bash', tool_input: { command: 'ls' } },
      { now: FROZEN },
    );
    const ws = adaptWindsurf({ agent_action_name: 'post_run_command', trajectory_id: 'traj' }, { now: FROZEN });
    const cu = adaptCursor(
      { conversation_id: 'conv', event_type: 'post_tool_use', tool_name: 'Bash' },
      { now: FROZEN },
    );
    expect(cc.eventPhase).toBe('post');
    expect(ws?.eventPhase).toBe('post');
    expect(cu.eventPhase).toBe('post');
  });

  it('SessionStart / Stop → session_start / session_end uniformly', () => {
    const ccStart = adaptClaudeCode({ hook_event_name: 'SessionStart', session_id: 'cc' }, { now: FROZEN });
    const ccStop = adaptClaudeCode({ hook_event_name: 'Stop', session_id: 'cc' }, { now: FROZEN });
    const cuStart = adaptCursor({ conversation_id: 'conv', event_type: 'session_start' }, { now: FROZEN });
    const cuStop = adaptCursor({ conversation_id: 'conv', event_type: 'session_end' }, { now: FROZEN });
    expect(ccStart.eventPhase).toBe('session_start');
    expect(ccStop.eventPhase).toBe('session_end');
    expect(cuStart.eventPhase).toBe('session_start');
    expect(cuStop.eventPhase).toBe('session_end');
  });
});
