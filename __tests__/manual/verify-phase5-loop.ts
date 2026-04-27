/**
 * Phase 5 — Whole-product closed-loop test.
 *
 * Connects to a long-running MCP HTTP server (booted out-of-band) AND
 * fires hook payloads at a long-running hooks-bridge. Both target the
 * same sqlite DB. Walks SessionStart -> get_run_id -> Pre/Post ->
 * record_decision -> Stop -> query_run_history.
 *
 * Read-only against source. Writes only to /tmp/.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = 'http://127.0.0.1:3199/mcp';
const BRIDGE_URL = 'http://127.0.0.1:3101';
const HOOK_SECRET = process.env.LOCAL_HOOK_SECRET ?? '';
const PROJECT_SLUG = 'verify-bridge-deny';
const SESSID = `phase5-ts-${Date.now()}`;

interface ToolResult {
  readonly content: ReadonlyArray<{ readonly text?: string }>;
}
function unwrap(r: unknown): Record<string, unknown> {
  return JSON.parse((r as ToolResult).content[0]?.text ?? '{}') as Record<string, unknown>;
}
function emit(label: string, payload: unknown): void {
  process.stdout.write(`${JSON.stringify({ label, payload })}\n`);
}

async function postHook(eventName: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BRIDGE_URL}/v1/hooks/claude-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Local-Hook-Secret': HOOK_SECRET,
    },
    body: JSON.stringify({
      session_id: SESSID,
      hook_event_name: eventName,
      cwd: '/tmp/verify-cwd',
      ...body,
    }),
  });
  return { status: res.status, body: await res.json() };
}

async function main(): Promise<void> {
  emit('begin', { sessid: SESSID });

  // (a) SessionStart hook
  emit('a/SessionStart', await postHook('SessionStart', {}));

  // (b) MCP get_run_id
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client({ name: 'phase5-loop', version: '0.0.0' });
  await client.connect(transport);
  const runIdResp = await client.callTool({
    name: 'get_run_id',
    arguments: { projectSlug: PROJECT_SLUG },
  });
  const runIdData = unwrap(runIdResp);
  emit('b/get_run_id', runIdData);
  const inner = (runIdData as { data?: { runId?: string } }).data;
  const runId = inner?.runId;
  if (!runId) throw new Error('no runId');

  // (c) PreToolUse hook (allow path)
  emit(
    'c/PreToolUse',
    await postHook('PreToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/safe/loop-ts.ts' },
      tool_use_id: 'tu-loop-ts-1',
    }),
  );

  // (c.1) PostToolUse hook
  emit(
    'c1/PostToolUse',
    await postHook('PostToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/safe/loop-ts.ts' },
      tool_use_id: 'tu-loop-ts-1',
    }),
  );

  // (d) MCP record_decision
  const decResp = await client.callTool({
    name: 'record_decision',
    arguments: {
      runId,
      description: 'Phase 5 closed-loop decision',
      rationale: 'walking the whole product',
    },
  });
  emit('d/record_decision', unwrap(decResp));

  // (e) Stop hook
  emit('e/Stop', await postHook('Stop', {}));

  // wait for async writes to drain
  await new Promise((r) => setTimeout(r, 1500));

  // (f) MCP query_run_history
  const histResp = await client.callTool({
    name: 'query_run_history',
    arguments: { projectSlug: PROJECT_SLUG, limit: 10 },
  });
  emit('f/query_run_history', unwrap(histResp));

  await client.close();
  emit('done', { ok: true });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
