import { describe, expect, it, vi } from 'vitest';

import type { PolicyCheck } from '../../../src/framework/policy-wrapper.js';
import {
  buildPolicyDecisionIdempotencyKey,
  createDevNullPolicyClient,
  createPolicyClient,
  createPolicyClientFromCheck,
  devNullPolicyCheck,
} from '../../../src/lib/policy.js';

/**
 * Integration test for `src/lib/policy.ts`.
 *
 * Proves:
 *   1. `createDevNullPolicyClient()` returns a `PolicyClient` whose
 *      `.evaluate` is `allow` for any input — no env reads, no DB,
 *      no network.
 *   2. `createPolicyClientFromCheck` forwards inputs verbatim to
 *      the supplied `PolicyCheck`, preserving the `phase`,
 *      `toolName`, and `idempotencyKey` fields unchanged.
 *   3. `createPolicyClientFromCheck` rejects non-functions at
 *      construction time.
 *
 * The registry auto-wrap (pre + post evaluation) is covered in
 * `__tests__/unit/framework/tool-registry.test.ts`; this file only
 * exercises the lib-level factory contract.
 */

describe('lib/policy — createDevNullPolicyClient', () => {
  it('evaluates every input as allow with the S7a reason string', async () => {
    const client = createDevNullPolicyClient();
    const out = await client.evaluate({
      toolName: 'ping',
      phase: 'pre',
      sessionId: 'sess_test',
      input: { echo: 'x' },
      idempotencyKey: { kind: 'readonly', key: 'readonly:test' },
    });
    expect(out.decision).toBe('allow');
    expect(out.reason).toMatch(/dev-null/);
    expect(out.matchedRuleId).toBeNull();
  });
});

describe('lib/policy — createPolicyClientFromCheck', () => {
  it('forwards input verbatim and returns the PolicyCheck result', async () => {
    const impl: PolicyCheck = async (req) => ({
      decision: 'deny' as const,
      reason: `denied:${req.phase}:${req.toolName}`,
      matchedRuleId: 'rule_abc',
    });
    const spy = vi.fn(impl);
    const client = createPolicyClientFromCheck(spy);
    const out = await client.evaluate({
      toolName: 'get_run_id',
      phase: 'post',
      sessionId: 'sess_xyz',
      input: { foo: 1 },
      idempotencyKey: { kind: 'mutating', key: 'run:abc' },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const call = (spy as unknown as { mock: { calls: Array<unknown[]> } }).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(call.toolName).toBe('get_run_id');
    expect(call.phase).toBe('post');
    expect(out.decision).toBe('deny');
    expect(out.reason).toBe('denied:post:get_run_id');
    expect(out.matchedRuleId).toBe('rule_abc');
  });

  it('rejects non-function arguments at construction time', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createPolicyClientFromCheck(undefined as unknown as any)).toThrow(/PolicyCheck function/);
  });

  it('devNullPolicyCheck export is a PolicyCheck function', async () => {
    expect(typeof devNullPolicyCheck).toBe('function');
    const out = await devNullPolicyCheck({
      toolName: 'any',
      sessionId: 'sess',
      idempotencyKey: { kind: 'readonly', key: 'x' },
      input: {},
      phase: 'pre',
    });
    expect(out.decision).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// S7b additions: the real factory's construction contract and the locked
// audit idempotency key format. Behavioural tests against a real DB live
// in `policy-db.test.ts`.
// ---------------------------------------------------------------------------

describe('lib/policy — createPolicyClient construction contract (S7b)', () => {
  it('throws TypeError when options is missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createPolicyClient(undefined as unknown as any)).toThrow(TypeError);
  });

  it('throws TypeError when options.db is not a DbHandle', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createPolicyClient({ db: {} as any })).toThrow(TypeError);
  });
});

describe('lib/policy — buildPolicyDecisionIdempotencyKey (S7b, §4.3 lock)', () => {
  it('formats as pd:{sessionId}:{toolName}:{eventType}', () => {
    const key = buildPolicyDecisionIdempotencyKey({
      sessionId: 'sess_abc',
      toolName: 'write_file',
      eventType: 'PreToolUse',
    });
    expect(key).toBe('pd:sess_abc:write_file:PreToolUse');
  });
});
