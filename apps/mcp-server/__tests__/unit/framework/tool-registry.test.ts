import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { IdempotencyKeyBuilder } from '../../../src/framework/idempotency.js';
import type { PolicyCheck } from '../../../src/framework/policy-wrapper.js';
import { MIN_DESCRIPTION_LENGTH, type ToolRegistration, ToolRegistry } from '../../../src/framework/tool-registry.js';

/**
 * `ToolRegistry` enforces its contract synchronously at registration
 * time. This suite locks every one of those invariants as an
 * individual negative test — a CI failure names exactly which rule
 * broke, and a future refactor that loosens the contract is caught
 * test-by-test rather than behind a single catch-all.
 *
 * Invariants covered (must stay in lock-step with the registry's
 * `assertValid`):
 *   1. Name shape matches ^[a-z][a-z0-9_]{2,63}$.
 *   2. Duplicate names are rejected.
 *   3. Description length ≥ MIN_DESCRIPTION_LENGTH (200).
 *   4. inputSchema must be a z.object.
 *   5. outputSchema is required.
 *   6. Handler arity is exactly 2.
 *   7. idempotencyKey builder must return a valid key (exercised
 *      via assertIdempotencyKeyBuilder).
 *
 * Plus three happy-path tests:
 *   A. A valid registration succeeds and appears in .list().
 *   B. handleCall routes through the policy wrapper (pre + post).
 *   C. handleCall returns a structured refusal on input-validation failure.
 */

const DESC = 'x'.repeat(MIN_DESCRIPTION_LENGTH);

const alwaysAllow: PolicyCheck = async () => ({
  decision: 'allow',
  reason: 'test',
  matchedRuleId: null,
});

const okIdempotency: IdempotencyKeyBuilder<{ a: string }> = (input, ctx) => ({
  kind: 'readonly',
  key: `readonly:test:${ctx.sessionId}:${input.a ?? ''}`.slice(0, 200),
});

function makeValidReg(
  overrides: Partial<ToolRegistration<z.ZodObject<{ a: z.ZodString }>, z.ZodObject<{ b: z.ZodString }>>> = {},
): ToolRegistration<z.ZodObject<{ a: z.ZodString }>, z.ZodObject<{ b: z.ZodString }>> {
  const inputSchema = z.object({ a: z.string() });
  const outputSchema = z.object({ b: z.string() });
  const base: ToolRegistration<typeof inputSchema, typeof outputSchema> = {
    name: 'valid_tool',
    description: DESC,
    inputSchema,
    outputSchema,
    idempotencyKey: okIdempotency as unknown as IdempotencyKeyBuilder<z.infer<typeof inputSchema>>,
    handler: async (input, _ctx) => ({ b: `echo:${input.a}` }),
  };
  return { ...base, ...overrides } as typeof base;
}

describe('ToolRegistry — register-time enforcement (negative cases)', () => {
  it('1. rejects a name that does not match the MCP shape', () => {
    const registry = new ToolRegistry(alwaysAllow);
    expect(() => registry.register(makeValidReg({ name: 'Invalid_Name' }))).toThrow(/invalid tool name/);
    expect(() => registry.register(makeValidReg({ name: 'a' }))).toThrow(/invalid tool name/);
    expect(() => registry.register(makeValidReg({ name: '9_starts_with_digit' }))).toThrow(/invalid tool name/);
    expect(() => registry.register(makeValidReg({ name: 'has-hyphen' }))).toThrow(/invalid tool name/);
  });

  it('2. rejects duplicate registrations', () => {
    const registry = new ToolRegistry(alwaysAllow);
    registry.register(makeValidReg({ name: 'dup_tool' }));
    expect(() => registry.register(makeValidReg({ name: 'dup_tool' }))).toThrow(/already registered/);
  });

  it('3. rejects descriptions shorter than the minimum', () => {
    const registry = new ToolRegistry(alwaysAllow);
    expect(() => registry.register(makeValidReg({ description: 'too short' }))).toThrow(
      new RegExp(`at least ${MIN_DESCRIPTION_LENGTH} characters`),
    );
    // boundary: exactly 199 chars fails
    expect(() => registry.register(makeValidReg({ description: 'x'.repeat(MIN_DESCRIPTION_LENGTH - 1) }))).toThrow(
      new RegExp(`at least ${MIN_DESCRIPTION_LENGTH} characters`),
    );
  });

  it('4. rejects an inputSchema that is not a z.object', () => {
    const registry = new ToolRegistry(alwaysAllow);
    const bad = makeValidReg();
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    const broken = { ...bad, inputSchema: z.string() as unknown as any };
    expect(() => registry.register(broken)).toThrow(/inputSchema must be a z\.object/);
  });

  it('5. rejects a registration missing outputSchema', () => {
    const registry = new ToolRegistry(alwaysAllow);
    const bad = makeValidReg();
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    const broken = { ...bad, outputSchema: undefined as unknown as any };
    expect(() => registry.register(broken)).toThrow(/outputSchema is required/);
  });

  it('6. rejects a handler whose arity is not exactly 2', () => {
    const registry = new ToolRegistry(alwaysAllow);
    const bad = makeValidReg();
    const arityZero = { ...bad, handler: (async () => ({ b: 'x' })) as unknown as typeof bad.handler };
    const arityOne = { ...bad, handler: (async (_i: unknown) => ({ b: 'x' })) as unknown as typeof bad.handler };
    expect(() => registry.register(arityZero)).toThrow(/handler must take exactly 2 args/);
    expect(() => registry.register(arityOne)).toThrow(/handler must take exactly 2 args/);
  });

  it('7. rejects a broken idempotency-key builder (wrong return shape)', () => {
    const registry = new ToolRegistry(alwaysAllow);
    const bad = makeValidReg({
      // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
      idempotencyKey: ((_i: unknown, _c: unknown) => 'not-an-object') as unknown as any,
    });
    expect(() => registry.register(bad)).toThrow(/invalid key/);
  });

  it('7b. rejects an idempotency builder returning an empty key', () => {
    const registry = new ToolRegistry(alwaysAllow);
    const bad = makeValidReg({
      // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
      idempotencyKey: ((_i: unknown, _c: unknown) => ({ kind: 'readonly', key: '' })) as unknown as any,
    });
    expect(() => registry.register(bad)).toThrow(/invalid key/);
  });
});

describe('ToolRegistry — happy path', () => {
  it('A. a valid registration appears in list(), sorted by name', () => {
    const registry = new ToolRegistry(alwaysAllow);
    registry.register(makeValidReg({ name: 'zeta_tool' }));
    registry.register(makeValidReg({ name: 'alpha_tool' }));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe('alpha_tool');
    expect(list[1]?.name).toBe('zeta_tool');
    expect(list[0]?.description).toHaveLength(MIN_DESCRIPTION_LENGTH);
    expect(list[0]?.inputSchema.type).toBe('object');
  });

  it('B. handleCall runs pre and post policy checks around the handler', async () => {
    const policyCalls: Array<{ phase: 'pre' | 'post'; toolName: string }> = [];
    const trackingPolicy: PolicyCheck = async (req) => {
      policyCalls.push({ phase: req.phase, toolName: req.toolName });
      return { decision: 'allow', reason: 'test', matchedRuleId: null };
    };
    const registry = new ToolRegistry(trackingPolicy);
    registry.register(makeValidReg({ name: 'traced_tool' }));
    const result = await registry.handleCall('traced_tool', { a: 'hi' }, 'sess_1');
    expect(result.isError).toBeUndefined();
    // Post-phase is fired and awaited inside the registry via a catch
    // side channel; give the microtask queue a turn so the post call
    // lands before we assert.
    await new Promise((r) => setImmediate(r));
    const phases = policyCalls.map((c) => c.phase);
    expect(phases).toContain('pre');
    expect(phases).toContain('post');
  });

  it('B2. handlers cannot opt out of the policy wrapper — a deny blocks the handler', async () => {
    const denyPolicy: PolicyCheck = async () => ({
      decision: 'deny',
      reason: 'test_deny',
      matchedRuleId: 'rule_test_1',
    });
    const handlerSpy = vi.fn(async (_i: unknown, _c: unknown) => ({ b: 'should-not-appear' }));
    const registry = new ToolRegistry(denyPolicy);
    registry.register(
      makeValidReg({
        name: 'denied_tool',
        handler: handlerSpy as unknown as ToolRegistration<
          z.ZodObject<{ a: z.ZodString }>,
          z.ZodObject<{ b: z.ZodString }>
        >['handler'],
      }),
    );
    const result = await registry.handleCall('denied_tool', { a: 'hi' }, 'sess_1');
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/policy_denied/);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('C. handleCall returns a structured refusal on invalid input', async () => {
    const registry = new ToolRegistry(alwaysAllow);
    registry.register(makeValidReg({ name: 'input_validated_tool' }));
    const result = await registry.handleCall('input_validated_tool', { a: 123 }, 'sess_1');
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid_input/);
  });

  it('C2. handleCall returns tool_not_found for unknown tools', async () => {
    const registry = new ToolRegistry(alwaysAllow);
    const result = await registry.handleCall('nope', {}, 'sess_1');
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/tool_not_found/);
  });
});
