import type { ToolCallContext } from '../../framework/tool-registry.js';

import type { PingInput, PingOutput } from './schema.js';

/**
 * Handler for `contextos__ping`. Pure, synchronous in intent (still
 * `async` to match the framework contract that every handler is a
 * promise-returning function). Returns a deterministic envelope that
 * the registry will validate against `pingOutputSchema` before it
 * reaches the transport.
 *
 * The handler does NOT read `process.env`, write to stdout, hit the
 * database, or touch the filesystem — deliberately. `ping` is our
 * oracle: if a round-trip works end-to-end, we know the registration,
 * manifest-from-zod, policy wrapper, stdio transport, and pino-to-
 * stderr plumbing are all correct. Any domain side effect here would
 * weaken that signal.
 */
export async function pingHandler(input: PingInput, ctx: ToolCallContext): Promise<PingOutput> {
  return {
    ok: true,
    pong: true,
    serverTime: ctx.receivedAt.toISOString(),
    sessionId: ctx.sessionId,
    idempotencyKey: ctx.idempotencyKey.key,
    ...(input.echo !== undefined ? { echo: input.echo } : {}),
  };
}
