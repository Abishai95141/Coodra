import type { Check } from '../types.js';

export const mcpHealthzCheck: Check = {
  id: 10,
  name: 'MCP server HTTP /healthz reachable',
  severity: 'yellow',
  async run(ctx) {
    return probeHealthz(`http://127.0.0.1:${ctx.mcpPort}/healthz`, ctx.timeoutMs - 200, 'MCP server');
  },
};

export async function probeHealthz(url: string, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 250));
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      return { status: 'green' as const, detail: `${label} 200 OK at ${url}` };
    }
    return {
      status: 'yellow' as const,
      detail: `${label} returned ${response.status} at ${url}`,
      remediation: `Inspect ${label} logs; the daemon is up but failing health checks.`,
    };
  } catch (err) {
    clearTimeout(timer);
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code === 'ECONNREFUSED') {
      return {
        status: 'yellow' as const,
        detail: `${label} not reachable at ${url} (ECONNREFUSED — service not running)`,
        remediation: 'Run `contextos start` to launch the daemons.',
      };
    }
    return {
      status: 'yellow' as const,
      detail: `${label} probe failed: ${(err as Error).message}`,
      remediation: 'Run `contextos start` and recheck.',
    };
  }
}
