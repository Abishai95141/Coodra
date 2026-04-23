import { UnauthorizedError } from '@contextos/shared';

import type { AuthClient, Identity } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/auth.ts` — auth abstraction shared by the
 * solo-bypass path and (from S7b) the Clerk-backed path.
 *
 * User constraint (S7a): "solo-bypass must be a real module behind
 * the same interface as Clerk-backed auth; no branching on env in
 * tool code". This file delivers that: every mode returns an
 * `AuthClient` satisfying the same interface; the mode dispatch
 * happens exactly once in `src/index.ts`:
 *
 *     ctx.auth =
 *       env.CLERK_SECRET_KEY === 'sk_test_replace_me'
 *         ? createSoloAuthClient()
 *         : createClerkAuthClient(env);     // S7b
 *
 * Tool handlers only ever see `ctx.auth`. If they need an
 * identity, they call `ctx.auth.requireIdentity()`; they do not care
 * which factory produced it.
 *
 * The solo identity is NOT `null`. The server still needs a
 * (userId, orgId) pair to stamp rows in `runs`, `context_packs`,
 * etc. so analytics queries work identically in solo and team mode.
 * We mint a stable pair (`user_dev_local` / `org_dev_local`) rather
 * than random UUIDs per boot so solo-mode traces are greppable and
 * joins across sessions still line up.
 */

const authLogger = createMcpLogger('lib-auth');

/** Stable solo identity — see docblock. */
export const SOLO_IDENTITY: Identity = Object.freeze({
  userId: 'user_dev_local',
  orgId: 'org_dev_local',
  source: 'solo-bypass',
} satisfies Identity);

/**
 * S7a factory — always returns the frozen solo identity. Zero I/O,
 * zero env reads (env is consumed at the index.ts dispatch site).
 * Warns on construction to make sure this factory cannot ship to
 * production team-mode unnoticed — the WARN is paired with the one
 * emitted by `createDevNullPolicyClient` for the same reason.
 */
export function createSoloAuthClient(): AuthClient {
  authLogger.warn(
    { event: 'auth_solo_bypass_in_use', identity: SOLO_IDENTITY },
    'createSoloAuthClient: returning fixed solo identity. ' +
      'Replace with createClerkAuthClient (S7b) before team-mode deployment.',
  );

  return {
    async getIdentity() {
      return SOLO_IDENTITY;
    },
    async requireIdentity() {
      return SOLO_IDENTITY;
    },
  };
}

/**
 * Thin factory helper for tests that need an `AuthClient` returning
 * no identity — exercises the `null` branch of `getIdentity` and the
 * throw branch of `requireIdentity`. Kept here (not in a test helper)
 * so the `AuthClient` interface stays the single source of truth for
 * what an anonymous caller looks like on the wire.
 */
export function createAnonymousAuthClient(): AuthClient {
  return {
    async getIdentity() {
      return null;
    },
    async requireIdentity() {
      throw new UnauthorizedError('no identity attached to this tool call');
    },
  };
}
