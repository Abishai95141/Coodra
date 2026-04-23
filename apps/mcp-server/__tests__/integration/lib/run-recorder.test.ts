import { describe, expect, it } from 'vitest';

import type { DbClient } from '../../../src/framework/tool-context.js';
import { NotImplementedError } from '../../../src/lib/errors.js';
import { createRunRecorder } from '../../../src/lib/run-recorder.js';

/**
 * Integration test for `src/lib/run-recorder.ts`.
 *
 * S7a stub. The test pins the user-directive Q2 contract: callers
 * pass `runId: string | null` — the nullable invariant is handled
 * INSIDE the recorder. The TYPE level acceptance of null is the
 * point; the runtime behaviour for both branches lands in S7c with
 * the outbox/SQL path.
 */

const fakeDb: DbClient = {
  db: {},
  async close() {
    /* no-op */
  },
};

describe('lib/run-recorder — createRunRecorder', () => {
  it('constructs when given a DbClient', () => {
    const recorder = createRunRecorder({ db: fakeDb });
    expect(typeof recorder.record).toBe('function');
  });

  it('rejects a missing DbClient at construction time', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional negative test
    expect(() => createRunRecorder({} as any)).toThrow(/deps\.db is required/);
  });

  it('record({ runId: "run_abc", ... }) throws NotImplementedError until S7c', async () => {
    const recorder = createRunRecorder({ db: fakeDb });
    await expect(
      recorder.record({
        runId: 'run_abc',
        toolName: 'ping',
        phase: 'pre',
        sessionId: 'sess',
        idempotencyKey: { kind: 'readonly', key: 'x' },
        input: {},
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('record({ runId: null, ... }) is a legal signature (PreToolUse fires before a run exists)', async () => {
    const recorder = createRunRecorder({ db: fakeDb });
    // User directive Q2: runId may be null, handled internally.
    await expect(
      recorder.record({
        runId: null,
        toolName: 'ping',
        phase: 'pre',
        sessionId: 'sess',
        idempotencyKey: { kind: 'readonly', key: 'x' },
        input: {},
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});
