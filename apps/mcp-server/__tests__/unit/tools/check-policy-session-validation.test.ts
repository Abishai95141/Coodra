import { describe, expect, it } from 'vitest';

import { checkPolicyInputSchema } from '../../../src/tools/check-policy/schema.js';

/**
 * Locks F5 closure (verification 2026-04-27): `check_policy.input.sessionId`
 * must reject colon-bearing values via `runKeySegmentSchema`. Before this
 * fix, a direct MCP caller could pass `sessionId: "has:colon"` and the
 * tool returned `allow / no_rule_matched` — a defense-in-depth gap that
 * the M02 §8.6 closure (framework `PerCallContext.sessionId` validation)
 * left open at the tool-input layer.
 *
 * The bridge's `normalizeSessionId` pre-sanitises agent-supplied ids at
 * hook ingress, so this rejection only fires for direct callers (or for
 * a regression in the bridge boundary).
 */

const baseValidInput = {
  projectSlug: 'verify-f5',
  agentType: 'claude_code',
  eventType: 'PreToolUse' as const,
  toolName: 'Write',
  toolInput: { file_path: '/tmp/x' },
};

describe('check_policy — sessionId validation (F5 closure)', () => {
  it('rejects sessionId containing `:` (run-key separator)', () => {
    const result = checkPolicyInputSchema.safeParse({
      ...baseValidInput,
      sessionId: 'has:colon',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const sessionIdIssue = result.error.issues.find((i) => i.path[0] === 'sessionId');
      expect(sessionIdIssue, JSON.stringify(result.error.issues)).toBeDefined();
      expect(sessionIdIssue?.message).toMatch(/:/);
    }
  });

  it('rejects empty sessionId', () => {
    const result = checkPolicyInputSchema.safeParse({
      ...baseValidInput,
      sessionId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sessionId longer than 256 chars', () => {
    const long = 'a'.repeat(257);
    const result = checkPolicyInputSchema.safeParse({
      ...baseValidInput,
      sessionId: long,
    });
    expect(result.success).toBe(false);
  });

  it('accepts canonical transport-generated sessionIds', () => {
    for (const sessionId of [
      'stdio-1c150d9e-f5a1-45a9-bc46-e9376bb3360e',
      'http-4216a2ac-3488-4d91-b2eb-f14b30dd0790',
      'verify-cc-has-colon-and-spaces-1', // post-normalizeSessionId shape
      'agent-X-traj-001',
    ]) {
      const result = checkPolicyInputSchema.safeParse({
        ...baseValidInput,
        sessionId,
      });
      expect(result.success, `expected accept: ${sessionId}`).toBe(true);
    }
  });

  it('rejects every additional `:` even when surrounded by valid chars', () => {
    for (const sessionId of ['a:b', ':leading', 'trailing:', 'middle:colon:here']) {
      const result = checkPolicyInputSchema.safeParse({
        ...baseValidInput,
        sessionId,
      });
      expect(result.success, `expected reject: ${sessionId}`).toBe(false);
    }
  });
});
