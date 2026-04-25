import { describe, expect, it } from 'vitest';

import { computeContentExcerpt } from '../../../src/lib/context-pack.js';

/**
 * Unit tests for `computeContentExcerpt` (Q-02-3 contract lock).
 *
 * The excerpt is the first 500 Unicode CODE POINTS of content with
 * trailing whitespace trimmed. `String.prototype.slice(0, 500)` would
 * operate on UTF-16 code units and corrupt surrogate pairs mid-
 * character for emoji and supplementary-plane CJK. `Array.from` +
 * slice on the resulting array is the safe path.
 *
 * These tests pin the contract with emoji at position 499 and CJK at
 * position 499 — the exact boundary where UTF-16 slicing breaks.
 */

const ROCKET = '🚀'; // code point U+1F680, two UTF-16 code units
const IDEOGRAPH = '𠮷'; // code point U+20BB7 (extension B, two UTF-16 units)

describe('computeContentExcerpt — short input', () => {
  it('returns the input unchanged when shorter than the limit', () => {
    const out = computeContentExcerpt('hello');
    expect(out).toBe('hello');
  });

  it('trims trailing whitespace so LIKE search is not poisoned', () => {
    expect(computeContentExcerpt('hello   \n\n')).toBe('hello');
  });

  it('handles empty input', () => {
    expect(computeContentExcerpt('')).toBe('');
  });
});

describe('computeContentExcerpt — Unicode at the slice boundary', () => {
  it('preserves a 2-code-unit emoji at code point 499 (the last kept char)', () => {
    // 499 "a" + one rocket emoji = 500 code points, emoji kept intact.
    const content = `${'a'.repeat(499)}${ROCKET}after`;
    const out = computeContentExcerpt(content);
    // Must end with the full emoji, NOT with a broken lead-surrogate.
    expect(out).toHaveLength('a'.repeat(499).length + ROCKET.length);
    expect(out.endsWith(ROCKET)).toBe(true);
  });

  it('preserves a 2-code-unit CJK ideograph at code point 499', () => {
    const content = `${'a'.repeat(499)}${IDEOGRAPH}after`;
    const out = computeContentExcerpt(content);
    expect(out.endsWith(IDEOGRAPH)).toBe(true);
  });

  it('truncates exactly at code point 500 — no emoji halving at position 500', () => {
    // 500 "a" + one rocket = 501 code points. Excerpt drops the emoji.
    const content = `${'a'.repeat(500)}${ROCKET}`;
    const out = computeContentExcerpt(content);
    expect(out).toBe('a'.repeat(500));
  });

  it('string.slice(0, 500) would break this — we must not use it', () => {
    const brokenByStringSlice = `${'a'.repeat(499)}${ROCKET}after`.slice(0, 500);
    // String#slice splits the emoji mid-surrogate here — the last char
    // is a lone lead surrogate (broken). Our impl must NOT produce
    // this output. Guards against future "fix" that breaks the contract.
    const badLast = brokenByStringSlice.charAt(brokenByStringSlice.length - 1);
    expect(badLast.charCodeAt(0)).toBeGreaterThanOrEqual(0xd800);
    expect(badLast.charCodeAt(0)).toBeLessThanOrEqual(0xdbff);

    const good = computeContentExcerpt(`${'a'.repeat(499)}${ROCKET}after`);
    // Last TWO chars together form the emoji surrogate pair.
    expect(good.slice(-2)).toBe(ROCKET);
  });
});

describe('computeContentExcerpt — explicit max override', () => {
  it('honours the optional max parameter', () => {
    expect(computeContentExcerpt('abcdef', 3)).toBe('abc');
  });
});
