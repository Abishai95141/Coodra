import { execa } from 'execa';
import type { Check } from '../types.js';

export const daemonManagerCheck: Check = {
  id: 16,
  name: 'Platform daemon manager reachable',
  severity: 'yellow',
  async run(ctx) {
    if (ctx.platform === 'darwin') {
      return probe('launchctl', ['version'], 'launchctl', ctx.timeoutMs);
    }
    if (ctx.platform === 'linux') {
      return probe('systemctl', ['--user', '--version'], 'systemctl --user', ctx.timeoutMs);
    }
    if (ctx.platform === 'win32') {
      return {
        status: 'yellow',
        detail: 'Windows uses the fallback (detached child) daemon strategy in 08a',
        remediation: 'Task Scheduler integration is deferred to a follow-up slice.',
      };
    }
    return { status: 'yellow', detail: `unknown platform ${ctx.platform} — fallback strategy applies` };
  },
};

async function probe(cmd: string, args: string[], label: string, timeoutMs: number) {
  try {
    const result = await execa(cmd, args, { timeout: Math.min(timeoutMs - 200, 1500), reject: false });
    if (result.exitCode === 0) {
      return { status: 'green' as const, detail: `${label} reachable` };
    }
    return {
      status: 'yellow' as const,
      detail: `${label} exited ${result.exitCode}: ${String(result.stderr).slice(0, 120)}`,
      remediation: `Confirm ${cmd} is on PATH and the user session can reach it.`,
    };
  } catch (err) {
    return {
      status: 'yellow' as const,
      detail: `${label} probe failed: ${(err as Error).message}`,
      remediation: 'CLI will fall back to detached-child daemon strategy.',
    };
  }
}
