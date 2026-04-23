import { describe, expect, it } from 'vitest';
import { devNullPolicyCheck } from '../../../src/framework/policy-wrapper.js';
import { MIN_DESCRIPTION_LENGTH, ToolRegistry } from '../../../src/framework/tool-registry.js';
import { pingToolRegistration } from '../../../src/tools/ping/manifest.js';

describe('ping tool — manifest contract', () => {
  it('description meets the §24.3 floor (>= MIN_DESCRIPTION_LENGTH)', () => {
    expect(pingToolRegistration.description.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_LENGTH);
  });

  it('description starts with "Call this" per §24.3 description recipe', () => {
    expect(pingToolRegistration.description).toMatch(/^Call this/i);
  });

  it('description mentions Returns to document the output shape', () => {
    expect(pingToolRegistration.description).toMatch(/Returns/);
  });

  it('name matches the MCP shape and is exactly "ping"', () => {
    expect(pingToolRegistration.name).toBe('ping');
    expect(pingToolRegistration.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });
});

describe('ping tool — end-to-end through the registry', () => {
  it('handleCall returns a well-formed pong envelope for an empty input', async () => {
    const registry = new ToolRegistry(devNullPolicyCheck);
    registry.register(pingToolRegistration);
    const result = await registry.handleCall('ping', {}, 'sess_test');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    const data = parsed.data as Record<string, unknown>;
    expect(data.pong).toBe(true);
    expect(typeof data.serverTime).toBe('string');
    expect(data.sessionId).toBe('sess_test');
    expect(typeof data.idempotencyKey).toBe('string');
    expect(data.idempotencyKey).toMatch(/^readonly:ping:sess_test:/);
  });

  it('echoes the input echo field back in the response', async () => {
    const registry = new ToolRegistry(devNullPolicyCheck);
    registry.register(pingToolRegistration);
    const result = await registry.handleCall('ping', { echo: 'hello world' }, 'sess_test');
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
    const data = parsed.data as Record<string, unknown>;
    expect(data.echo).toBe('hello world');
  });

  it('rejects an oversized echo (>256 chars) via the input schema', async () => {
    const registry = new ToolRegistry(devNullPolicyCheck);
    registry.register(pingToolRegistration);
    const result = await registry.handleCall('ping', { echo: 'x'.repeat(257) }, 'sess_test');
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid_input/);
  });

  it('idempotency-key builder is pure for the same (input, sessionId)', async () => {
    // Call twice with identical args; the key component derived from
    // (sessionId, echo) must match across both calls even though the
    // receivedAt differs — confirming the builder is not reading
    // receivedAt.
    const registry = new ToolRegistry(devNullPolicyCheck);
    registry.register(pingToolRegistration);
    const a = await registry.handleCall('ping', { echo: 'x' }, 'sess_test');
    const b = await registry.handleCall('ping', { echo: 'x' }, 'sess_test');
    const dataA = (JSON.parse(a.content[0]?.text ?? '{}') as Record<string, unknown>).data as Record<string, unknown>;
    const dataB = (JSON.parse(b.content[0]?.text ?? '{}') as Record<string, unknown>).data as Record<string, unknown>;
    expect(dataA.idempotencyKey).toBe(dataB.idempotencyKey);
  });
});
