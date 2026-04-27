/**
 * F5 closure live demonstration — spawns a fresh stdio subprocess
 * against the current rebuilt dist (NOT the IDE's stale subprocess)
 * and calls check_policy with sessionId='has:colon'. Pastes the
 * actual response.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const SERVER_BIN = resolve(ROOT, 'apps/mcp-server/dist/index.js');

async function main(): Promise<void> {
  const sqliteDir = mkdtempSync(join(tmpdir(), 'verify-f5-live-'));
  const sqlitePath = join(sqliteDir, 'data.db');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_BIN, '--transport', 'stdio'],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      CONTEXTOS_SQLITE_PATH: sqlitePath,
      CONTEXTOS_LOG_DESTINATION: 'stderr',
      CONTEXTOS_MODE: 'solo',
      CLERK_SECRET_KEY: 'sk_test_replace_me',
      CLERK_PUBLISHABLE_KEY: 'pk_test_replace_me',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'verify-f5-live', version: '0.0.0' });
  await client.connect(transport);

  // Make sure a project exists so check_policy reaches the schema-validation layer
  // (project_not_found short-circuits before sessionId validation otherwise).
  await client.callTool({ name: 'get_run_id', arguments: { projectSlug: 'verify-f5-live' } });

  // The actual ask: colon-bearing sessionId. Pre-fix dist returns
  // permissionDecision='allow'; post-fix dist returns invalid_input.
  const result = await client.callTool({
    name: 'check_policy',
    arguments: {
      projectSlug: 'verify-f5-live',
      sessionId: 'has:colon',
      agentType: 'claude_code',
      eventType: 'PreToolUse',
      toolName: 'Write',
      toolInput: { file_path: '/tmp/x.ts' },
    },
  });
  const text = (result as { content: { text: string }[] }).content[0]?.text ?? '{}';
  process.stdout.write(`${text}\n`);

  await client.close();
  rmSync(sqliteDir, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
