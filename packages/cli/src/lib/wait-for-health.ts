/**
 * Polls a URL with exponential backoff (capped at 1s) until it returns 2xx
 * or `timeoutMs` elapses. Returns true on success, false on timeout. Used
 * by `start` to gate the "Started" message on the daemon actually serving.
 */
export interface WaitForHealthOptions {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export async function waitForHealth(options: WaitForHealthOptions): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let backoff = options.initialBackoffMs ?? 100;
  const maxBackoff = options.maxBackoffMs ?? 1000;
  const doFetch = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const probeTimeout = setTimeout(() => controller.abort(), Math.min(backoff * 4, 2000));
      const response = await doFetch(options.url, { signal: controller.signal });
      clearTimeout(probeTimeout);
      if (response.ok) return true;
    } catch {
      // not yet up — back off and retry.
    }
    await sleep(backoff);
    backoff = Math.min(backoff * 2, maxBackoff);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
