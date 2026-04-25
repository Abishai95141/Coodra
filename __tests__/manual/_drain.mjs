import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const url = process.argv[2];
const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
const client = new Client({ name: 'drain-verify', version: '0.0' }, { capabilities: {} });
await client.connect(transport);
const args = {
  projectSlug: 'coodra',
  sessionId: 'drain-session-' + Date.now(),
  agentType: 'claude_code',
  eventType: 'PreToolUse',
  toolName: 'Write',
  toolInput: { file_path: '/tmp/drain.ts' },
};
const r = await client.callTool({ name: 'check_policy', arguments: args });
console.log('CALL_RESULT:', JSON.stringify(JSON.parse(r.content[0].text)));
console.log('SESSION_ID:', args.sessionId);
await client.close();
