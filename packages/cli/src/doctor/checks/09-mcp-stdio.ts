import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { findRepoRoot } from '../../lib/find-repo-root.js';
import type { Check } from '../types.js';

export const mcpStdioCheck: Check = {
  id: 9,
  name: 'MCP server reachable on stdio',
  severity: 'red',
  async run(ctx) {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = await findRepoRoot(here);
    if (repoRoot === null) {
      return { status: 'skipped', detail: 'cannot locate repo root from CLI install path' };
    }
    const binPath = resolve(repoRoot, 'apps/mcp-server/dist/index.js');
    let exists = true;
    try {
      const { access } = await import('node:fs/promises');
      await access(binPath);
    } catch {
      exists = false;
    }
    if (!exists) {
      return {
        status: 'yellow',
        detail: `mcp-server dist not found at ${binPath}`,
        remediation: 'Run `pnpm --filter @contextos/mcp-server build` to produce the stdio binary.',
      };
    }

    try {
      // Try a fast initialize handshake: pipe a single JSON-RPC initialize and read until response.
      const message = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'doctor', version: '1' } },
      });
      const child = execa('node', [binPath, '--transport', 'stdio'], {
        input: `${message}\n`,
        timeout: Math.min(ctx.timeoutMs - 200, 1500),
        env: { ...ctx.env, CONTEXTOS_LOG_DESTINATION: 'stderr' },
        reject: false,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const result = await child;
      const out = String(result.stdout ?? '');
      if (out.includes('"jsonrpc":"2.0"') && out.includes('"id":1')) {
        return { status: 'green', detail: 'MCP server responded to initialize' };
      }
      return {
        status: 'red',
        detail: `MCP stdio handshake failed (exit ${result.exitCode}); stderr=${String(result.stderr).slice(0, 200)}`,
        remediation: 'Inspect mcp-server logs; ensure dist is up to date.',
      };
    } catch (err) {
      return {
        status: 'red',
        detail: `MCP stdio probe error: ${(err as Error).message}`,
        remediation: 'Confirm mcp-server is built and Node is on PATH.',
      };
    }
  },
};
