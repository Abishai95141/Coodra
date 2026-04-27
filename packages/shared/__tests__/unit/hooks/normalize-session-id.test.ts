import { describe, expect, it } from 'vitest';

import { normalizeSessionId } from '../../../src/hooks/normalize-session-id.js';

/**
 * Locks the seven sanitization fixtures from the verification §8.6
 * carryover. Every external boundary that takes an agent-supplied
 * session id MUST go through this function.
 */

describe('normalizeSessionId', () => {
  it('passes a vanilla UUID through unchanged', () => {
    expect(normalizeSessionId('abc12345-6789-4abc-9def-0123456789ab')).toBe('abc12345-6789-4abc-9def-0123456789ab');
  });

  it('strips colons from a Claude Code `:fork-N` style id', () => {
    expect(normalizeSessionId('claude-code-abc:fork-2')).toBe('claude-code-abc-fork-2');
  });

  it('strips a leading or trailing colon', () => {
    expect(normalizeSessionId(':leading')).toBe('leading');
    expect(normalizeSessionId('trailing:')).toBe('trailing');
  });

  it('replaces every Windows-reserved char with a hyphen', () => {
    expect(normalizeSessionId('a<b>c"d/e\\f|g?h*i')).toBe('a-b-c-d-e-f-g-h-i');
  });

  it('collapses whitespace and runs of hyphens to a single hyphen', () => {
    expect(normalizeSessionId('foo   bar')).toBe('foo-bar');
    expect(normalizeSessionId('foo----bar')).toBe('foo-bar');
    expect(normalizeSessionId('foo \t bar')).toBe('foo-bar');
  });

  it('strips backslashes (Windows-style paths if accidentally pasted)', () => {
    expect(normalizeSessionId('a\\b\\c')).toBe('a-b-c');
  });

  it('throws ZodError when the result is empty (after sanitization)', () => {
    expect(() => normalizeSessionId('')).toThrow();
    expect(() => normalizeSessionId(':::')).toThrow();
    expect(() => normalizeSessionId('   ')).toThrow();
  });
});
