import { probePort } from '../../lib/probe-port.js';
import type { Check } from '../types.js';

export const port3101Check: Check = {
  id: 18,
  name: 'Hooks Bridge port 3101 availability',
  severity: 'yellow',
  async run(ctx) {
    return probePort(ctx.bridgePort, 'Hooks Bridge');
  },
};
