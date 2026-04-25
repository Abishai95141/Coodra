import { describe, expect, it } from 'vitest';

import { ToolRegistry } from '../../../src/framework/tool-registry.js';
import { pingToolRegistration } from '../../../src/tools/ping/manifest.js';
import { makeFakeDeps } from '../../helpers/fake-deps.js';

/**
 * Schema-layer sessionId validation (verification finding §8.6 fix).
 *
 * The runId encoding `run:{projectId}:{sessionId}:{uuid}` requires
 * sessionId to contain no `:`. Before this fix, the constraint lived
 * in `assertRunKeySegment` inside `generateRunKey` — a runtime throw
 * after the handler entered, surfaced as `handler_threw`.
 *
 * The registry now validates sessionId via `runKeySegmentSchema` at the
 * `handleCall` boundary BEFORE any handler runs. Failures return a
 * structured `invalid_input` envelope with `field: 'sessionId'`.
 */

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry({ deps: makeFakeDeps() });
  registry.register(pingToolRegistration);
  return registry;
}

describe('tool-registry — sessionId schema validation', () => {
  it('rejects sessionId containing colon → invalid_input + field:sessionId, NOT handler_threw', async () => {
    const result = await buildRegistry().handleCall('ping', { echo: 'x' }, 'bad:value');
    const env = JSON.parse((result.content as ReadonlyArray<{ text: string }>)[0]?.text ?? '{}') as {
      ok: boolean;
      error: string;
      tool: string;
      field?: string;
    };
    expect(env.ok).toBe(false);
    expect(env.error).toBe('invalid_input');
    expect(env.tool).toBe('ping');
    expect(env.field).toBe('sessionId');
  });

  it('rejects empty sessionId → invalid_input', async () => {
    const result = await buildRegistry().handleCall('ping', { echo: 'x' }, '');
    const env = JSON.parse((result.content as ReadonlyArray<{ text: string }>)[0]?.text ?? '{}') as {
      ok: boolean;
      error: string;
      field?: string;
    };
    expect(env.ok).toBe(false);
    expect(env.error).toBe('invalid_input');
    expect(env.field).toBe('sessionId');
  });

  it('accepts post-S17 transport-shaped sessionIds (hyphen separator)', async () => {
    const result = await buildRegistry().handleCall('ping', { echo: 'x' }, 'stdio-12345-abcde');
    const env = JSON.parse((result.content as ReadonlyArray<{ text: string }>)[0]?.text ?? '{}') as { ok: boolean };
    expect(env.ok).toBe(true);
  });

  it('the registry boundary check runs BEFORE the handler — even tools with no sessionId dependency see the rejection', async () => {
    // Ping does not consume sessionId in any way. The rejection must
    // still surface because the registry validates BEFORE dispatch.
    const result = await buildRegistry().handleCall('ping', { echo: 'irrelevant' }, 'has:colon');
    const env = JSON.parse((result.content as ReadonlyArray<{ text: string }>)[0]?.text ?? '{}') as { error: string };
    expect(env.error).toBe('invalid_input');
  });
});
