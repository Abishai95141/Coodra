import { describe, expect, it, vi } from 'vitest';
import { waitForHealth } from '../../src/lib/wait-for-health.js';

describe('waitForHealth', () => {
  it('returns true when fetch resolves 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const ok = await waitForHealth({
      url: 'http://x/healthz',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries on rejection with exponential backoff and eventually succeeds', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n < 3) throw new Error('connection refused');
      return { ok: true } as Response;
    });
    const ok = await waitForHealth({
      url: 'http://x/healthz',
      timeoutMs: 5000,
      initialBackoffMs: 5,
      maxBackoffMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('returns false when timeout elapses without 2xx', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('econnrefused');
    });
    const ok = await waitForHealth({
      url: 'http://x/healthz',
      timeoutMs: 60,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ok).toBe(false);
  });
});
