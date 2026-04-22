import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/errors/index.js';
import { generateRunEventKey, generateRunKey, RUN_EVENT_KEY_PATTERN, RUN_KEY_PATTERN } from '../../src/idempotency.js';

/**
 * Amendment A of the bootstrap plan: these regex patterns are literal copies
 * of `system-architecture.md` §4.3. The tests below assert *shape* — not
 * implementation detail — so that any drift in the key format breaks CI.
 */

describe('generateRunKey', () => {
  it('produces a string matching run:{projectId}:{sessionId}:{uuid}', () => {
    const key = generateRunKey({ projectId: 'proj_abc', sessionId: 'sess_123' });
    expect(key).toMatch(RUN_KEY_PATTERN);
  });

  it('pattern matches the §4.3 regex literally', () => {
    // If RUN_KEY_PATTERN ever drifts from the architecture, this test fails
    // loudly. Do not loosen this regex without updating §4.3 first.
    expect(RUN_KEY_PATTERN.source).toBe(
      '^run:[^:]+:[^:]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    );
  });

  it('embeds the exact projectId and sessionId verbatim', () => {
    const key = generateRunKey({ projectId: 'proj-with-dashes', sessionId: 'sess_42' });
    expect(key.startsWith('run:proj-with-dashes:sess_42:')).toBe(true);
  });

  it('produces a fresh UUID v4 on each call', () => {
    const a = generateRunKey({ projectId: 'p', sessionId: 's' });
    const b = generateRunKey({ projectId: 'p', sessionId: 's' });
    expect(a).not.toEqual(b);
  });

  it('rejects empty projectId', () => {
    expect(() => generateRunKey({ projectId: '', sessionId: 's' })).toThrow(ValidationError);
  });

  it('rejects empty sessionId', () => {
    expect(() => generateRunKey({ projectId: 'p', sessionId: '' })).toThrow(ValidationError);
  });

  it("rejects projectId containing ':'", () => {
    expect(() => generateRunKey({ projectId: 'has:colon', sessionId: 's' })).toThrow(ValidationError);
  });

  it("rejects sessionId containing ':'", () => {
    expect(() => generateRunKey({ projectId: 'p', sessionId: 'has:colon' })).toThrow(ValidationError);
  });

  it('allows dashes in projectId and sessionId (not a run-key separator)', () => {
    const key = generateRunKey({ projectId: 'proj-a-b', sessionId: 'sess-1-2' });
    expect(key).toMatch(RUN_KEY_PATTERN);
  });
});

describe('generateRunEventKey', () => {
  it('produces a string matching {sessionId}-{toolUseId}-{phase}', () => {
    const key = generateRunEventKey({ sessionId: 'sess_123', toolUseId: 'tool_abc', phase: 'pre' });
    expect(key).toMatch(RUN_EVENT_KEY_PATTERN);
    expect(key).toBe('sess_123-tool_abc-pre');
  });

  it('pattern matches the §4.3 regex literally', () => {
    expect(RUN_EVENT_KEY_PATTERN.source).toBe('^[^:-]+-[^:-]+-(pre|post)$');
  });

  it("accepts 'post' phase", () => {
    const key = generateRunEventKey({ sessionId: 's', toolUseId: 't', phase: 'post' });
    expect(key).toBe('s-t-post');
  });

  it('is deterministic: same inputs always yield the same key', () => {
    const args = { sessionId: 's', toolUseId: 't', phase: 'pre' as const };
    expect(generateRunEventKey(args)).toBe(generateRunEventKey(args));
  });

  it("rejects phase other than 'pre' or 'post'", () => {
    // @ts-expect-error — invalid phase by design
    expect(() => generateRunEventKey({ sessionId: 's', toolUseId: 't', phase: 'middle' })).toThrow(ValidationError);
  });

  it('rejects empty sessionId', () => {
    expect(() => generateRunEventKey({ sessionId: '', toolUseId: 't', phase: 'pre' })).toThrow(ValidationError);
  });

  it('rejects empty toolUseId', () => {
    expect(() => generateRunEventKey({ sessionId: 's', toolUseId: '', phase: 'pre' })).toThrow(ValidationError);
  });

  it("rejects sessionId containing '-'", () => {
    expect(() => generateRunEventKey({ sessionId: 'has-hyphen', toolUseId: 't', phase: 'pre' })).toThrow(
      ValidationError,
    );
  });

  it("rejects toolUseId containing '-'", () => {
    expect(() => generateRunEventKey({ sessionId: 's', toolUseId: 'has-hyphen', phase: 'pre' })).toThrow(
      ValidationError,
    );
  });

  it("rejects sessionId containing ':'", () => {
    expect(() => generateRunEventKey({ sessionId: 'has:colon', toolUseId: 't', phase: 'pre' })).toThrow(
      ValidationError,
    );
  });

  it("rejects toolUseId containing ':'", () => {
    expect(() => generateRunEventKey({ sessionId: 's', toolUseId: 'has:colon', phase: 'pre' })).toThrow(
      ValidationError,
    );
  });
});
