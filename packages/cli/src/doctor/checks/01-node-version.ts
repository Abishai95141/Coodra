import type { Check } from '../types.js';

const MIN_NODE = '22.16.0';

export const nodeVersionCheck: Check = {
  id: 1,
  name: 'Node.js >= 22.16.0',
  severity: 'red',
  async run(ctx) {
    const current = ctx.nodeVersion;
    if (compareSemver(current, MIN_NODE) >= 0) {
      return { status: 'green', detail: `Node ${current}` };
    }
    return {
      status: 'red',
      detail: `Node ${current} is below ${MIN_NODE}`,
      remediation: `Upgrade Node to >= ${MIN_NODE}; the repo's .nvmrc points at the supported version. Try \`nvm use\` or \`fnm use\`.`,
    };
  },
};

function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map((s) => Number.parseInt(s, 10));
  const bParts = b.split('.').map((s) => Number.parseInt(s, 10));
  for (let i = 0; i < 3; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}
