import type { Check } from '../types.js';
import { probeHealthz } from './10-mcp-healthz.js';

export const bridgeHealthzCheck: Check = {
  id: 11,
  name: 'Hooks Bridge HTTP /healthz reachable',
  severity: 'yellow',
  async run(ctx) {
    return probeHealthz(`http://127.0.0.1:${ctx.bridgePort}/healthz`, ctx.timeoutMs - 200, 'Hooks Bridge');
  },
};
