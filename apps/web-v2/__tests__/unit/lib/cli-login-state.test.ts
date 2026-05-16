import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __cliLoginStateCount, __resetCliLoginStateForTest, consumeCliLoginState } from '../../../lib/cli-login-state';

/**
 * Unit tests for `apps/web-v2/lib/cli-login-state.ts` (Phase G slice G.2).
 *
 * The module is in-memory only and has a 5-minute TTL on entries. We
 * test the happy path + replay protection + TTL eviction.
 */

beforeEach(() => {
  __resetCliLoginStateForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('consumeCliLoginState', () => {
  it('returns true on first use of a state', () => {
    expect(consumeCliLoginState('abc123')).toBe(true);
  });

  it('returns false on second use of the same state', () => {
    expect(consumeCliLoginState('abc123')).toBe(true);
    expect(consumeCliLoginState('abc123')).toBe(false);
  });

  it('tracks distinct states independently', () => {
    expect(consumeCliLoginState('alpha')).toBe(true);
    expect(consumeCliLoginState('beta')).toBe(true);
    expect(consumeCliLoginState('alpha')).toBe(false);
    expect(consumeCliLoginState('beta')).toBe(false);
  });

  it('GCs entries older than 5 minutes', () => {
    const realNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(realNow);

    consumeCliLoginState('expiring');
    expect(__cliLoginStateCount()).toBe(1);

    // Advance 6 minutes (past TTL)
    vi.setSystemTime(realNow + 6 * 60 * 1000);

    // GC runs lazily on the next consume call
    expect(consumeCliLoginState('different-state')).toBe(true);
    expect(__cliLoginStateCount()).toBe(1); // only the new state, old GC'd

    // The expired state is now consumable again (which is fine — the
    // legitimate CLI flow has already moved on or timed out)
    expect(consumeCliLoginState('expiring')).toBe(true);
  });

  it('GCs lazily without explicit timer ticks', () => {
    const realNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(realNow);

    consumeCliLoginState('a');
    consumeCliLoginState('b');
    consumeCliLoginState('c');
    expect(__cliLoginStateCount()).toBe(3);

    // Advance past TTL
    vi.setSystemTime(realNow + 6 * 60 * 1000);
    expect(__cliLoginStateCount()).toBe(0);
  });
});

describe('__resetCliLoginStateForTest', () => {
  it('clears all entries', () => {
    consumeCliLoginState('a');
    consumeCliLoginState('b');
    expect(__cliLoginStateCount()).toBeGreaterThan(0);
    __resetCliLoginStateForTest();
    expect(__cliLoginStateCount()).toBe(0);
  });
});
