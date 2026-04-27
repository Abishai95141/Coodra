import { describe, expect, it } from 'vitest';

import { adaptClaudeCode } from '../../../src/hooks/adapters/claude-code.js';
import { ClaudeCodeHookPayloadSchema } from '../../../src/hooks/payloads/claude-code.js';

const FROZEN = () => new Date('2026-04-25T12:00:00.000Z');

describe('Claude Code adapter', () => {
  it('PreToolUse with full payload produces the canonical HookEvent', () => {
    const event = adaptClaudeCode(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-abc-123',
        tool_name: 'Write',
        tool_input: { file_path: 'src/x.ts', content: '...' },
        tool_use_id: 'tool-xyz',
        cwd: '/repo',
      },
      { now: FROZEN },
    );
    expect(event).toEqual({
      agentType: 'claude_code',
      eventPhase: 'pre',
      sessionId: 'sess-abc-123',
      turnId: 'tool-xyz',
      toolName: 'Write',
      filePath: 'src/x.ts',
      toolInput: { file_path: 'src/x.ts', content: '...' },
      cwd: '/repo',
      rawAt: '2026-04-25T12:00:00.000Z',
    });
  });

  it('UserPromptSubmit folds prompt + promptId into toolInput under a stable sentinel toolName', () => {
    const event = adaptClaudeCode(
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess',
        prompt: 'rename the foo function to bar',
        prompt_id: 'prompt-001',
      },
      { now: FROZEN },
    );
    expect(event.eventPhase).toBe('user_prompt');
    expect(event.toolName).toBe('user_prompt');
    expect(event.toolInput).toEqual({ prompt: 'rename the foo function to bar', promptId: 'prompt-001' });
  });

  it('normalizes session_id with a colon (Claude Code fork notation)', () => {
    const event = adaptClaudeCode({ hook_event_name: 'PreToolUse', session_id: 'sess-abc:fork-2' }, { now: FROZEN });
    expect(event.sessionId).toBe('sess-abc-fork-2');
  });

  it('payload schema rejects unknown top-level fields (.strict())', () => {
    const result = ClaudeCodeHookPayloadSchema.safeParse({
      hook_event_name: 'PreToolUse',
      session_id: 'sess',
      bogus_field: 'should fail',
    });
    expect(result.success).toBe(false);
  });

  it('payload schema rejects unknown hook_event_name values', () => {
    const result = ClaudeCodeHookPayloadSchema.safeParse({
      hook_event_name: 'NotAnEvent',
      session_id: 'sess',
    });
    expect(result.success).toBe(false);
  });
});
