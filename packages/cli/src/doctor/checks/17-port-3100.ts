import { probePort } from '../../lib/probe-port.js';
import type { Check } from '../types.js';

export const port3100Check: Check = {
  id: 17,
  name: 'MCP server port 3100 availability',
  severity: 'yellow',
  async run(ctx) {
    return probePort(ctx.mcpPort, 'MCP server');
  },
};
