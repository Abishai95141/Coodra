import { describe, expect, it } from 'vitest';

import { contextPackFilename } from '../../../src/lib/context-pack.js';

/**
 * Lock the filename format introduced by verification finding §8.4.
 * Pre-fix: `${yyyyMmDd}-${runId.slice(0, 8)}.md` produced
 * `2026-04-25-run:proj.md` from a colon-bearing runId — Windows-hostile.
 * Post-fix: every Windows-reserved char is replaced with `-`, slice 16.
 */

const FIXED_DATE = new Date('2026-04-25T12:00:00Z');

describe('contextPackFilename — verification finding §8.4', () => {
  it('replaces colons in the runId with hyphens', () => {
    const got = contextPackFilename('run:proj_abc123:stdio-xx:yy', FIXED_DATE);
    expect(got).not.toContain(':');
    // After sanitize: 'run-proj_abc123-stdio-xx-yy' → slice(0, 16) = 'run-proj_abc123-'
    expect(got).toBe('2026-04-25-run-proj_abc123-.md');
  });

  it('replaces every Windows-reserved char (<>:"/\\\\|?*) with a hyphen', () => {
    const got = contextPackFilename('a<b>c:d"e/f\\g|h?i*j', FIXED_DATE);
    expect(got).toMatch(/^2026-04-25-/);
    // Exactly 16 chars after the date prefix, all reserved chars sanitized.
    const suffix = got.slice('2026-04-25-'.length, -'.md'.length);
    expect(suffix.length).toBeLessThanOrEqual(16);
    expect(suffix).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('truncates the runId to 16 chars after sanitisation', () => {
    const longRun = `run:${'x'.repeat(40)}`;
    const got = contextPackFilename(longRun, FIXED_DATE);
    const suffix = got.slice('2026-04-25-'.length, -'.md'.length);
    expect(suffix.length).toBe(16);
  });

  it('preserves alphanumeric + hyphen + underscore in the runId', () => {
    const got = contextPackFilename('plain_run-id-12345-abcdef', FIXED_DATE);
    // No reserved chars → no replacement → slice(0, 16) = 'plain_run-id-123'
    expect(got).toBe('2026-04-25-plain_run-id-123.md');
  });

  it('uses the provided UTC date for the prefix (clock-discipline)', () => {
    const earlier = new Date('1999-12-31T23:59:59Z');
    const got = contextPackFilename('run-id', earlier);
    expect(got).toMatch(/^1999-12-31-/);
  });

  it('the format never contains a literal colon, regardless of runId', () => {
    const adversarial = ':::::::::::::::::::::::::::::::';
    const got = contextPackFilename(adversarial, FIXED_DATE);
    expect(got).not.toContain(':');
  });
});
