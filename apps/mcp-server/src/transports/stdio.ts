import { createLogger } from '@contextos/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, type CallToolResult, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { ToolRegistry } from '../framework/tool-registry.js';

/**
 * Stdio transport bootstrap.
 *
 * `@modelcontextprotocol/sdk` exposes two API surfaces:
 *   1. `McpServer` — high-level, prescriptive: it owns input parsing
 *      via Zod raw shapes, output formatting, and tool dispatch.
 *   2. `Server` — low-level: you register request handlers and own
 *      everything from schema validation onwards.
 *
 * We deliberately use (2). Our `ToolRegistry` already owns input
 * validation (via the author's Zod schemas), output validation, the
 * idempotency-key contract, and the automatic policy wrapper. Routing
 * calls through `McpServer.registerTool` would duplicate that work
 * and make the single-source-of-truth invariant ambiguous. The SDK
 * marks `Server` as `@deprecated` in favour of `McpServer`, but that
 * annotation means "only use `Server` for advanced use cases" — which
 * is precisely where we are.
 *
 * S5 transport scope: stdio only. HTTP (Streamable HTTP) is deferred
 * to S16. The stdio channel is a trusted local parent-process pipe,
 * so no auth layer is attached here; the Clerk + solo-bypass +
 * LOCAL_HOOK_SECRET chain (S7b) lives on the HTTP path only.
 *
 * Stdio discipline:
 *   - stdout is reserved exclusively for JSON-RPC frames written by
 *     the SDK's `StdioServerTransport`.
 *   - Every log line from our code AND every log line from transitive
 *     dependencies (notably `@contextos/db`'s sqlite-vec loader) goes
 *     to stderr. That is guaranteed by the `./bootstrap/ensure-stderr-
 *     logging.js` import at the top of `src/index.ts`, which sets
 *     `CONTEXTOS_LOG_DESTINATION=stderr` before `@contextos/shared`'s
 *     logger module is evaluated.
 *   - No `console.log` / `console.info` in mcp-server source. Writing
 *     to stdout from handler code corrupts the transport. Lint would
 *     catch raw `console.log` via biome's `noConsole` rule, but we
 *     keep that rule's `allow: ['error', 'warn']` exception in mind:
 *     console.error / console.warn go to stderr and are harmless.
 */

const stdioLogger = createLogger('mcp-server.transport-stdio');

export interface StdioStartOptions {
  readonly registry: ToolRegistry;
  readonly serverName: string;
  readonly serverVersion: string;
  /**
   * Stable session id bound for the lifetime of this stdio process.
   * In stdio, one process == one session, so we mint it at boot.
   */
  readonly sessionId: string;
}

export async function startStdioTransport(opts: StdioStartOptions): Promise<{
  readonly close: () => Promise<void>;
}> {
  const { registry, serverName, serverVersion, sessionId } = opts;

  const server = new Server(
    {
      name: serverName,
      version: serverVersion,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // tools/list → the registry's pre-sorted list response. No expensive
  // work here; the registry memoises the JSON Schema per tool at
  // registration time.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = registry.list();
    return { tools: tools.map((t) => ({ ...t })) };
  });

  // tools/call → registry.handleCall, which runs input validation,
  // idempotency-key build, pre-phase policy check, the handler, output
  // validation, and post-phase policy check. Returns the MCP-shaped
  // envelope directly.
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const result = await registry.handleCall(name, args ?? {}, sessionId);
    // Our ToolResult is shape-compatible with the SDK's CallToolResult
    // ({ content, isError?, structuredContent? }); the cast narrows the
    // SDK's ServerResult union to the branch we actually produce.
    return result as unknown as CallToolResult;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  stdioLogger.info(
    {
      event: 'stdio_transport_ready',
      serverName,
      serverVersion,
      sessionId,
      toolCount: registry.size(),
    },
    'stdio transport connected',
  );

  return {
    close: async () => {
      await server.close();
      stdioLogger.info({ event: 'stdio_transport_closed', sessionId }, 'stdio transport closed');
    },
  };
}
