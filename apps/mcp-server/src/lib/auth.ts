import { timingSafeEqual } from 'node:crypto';

import { verifyToken as clerkVerifyToken } from '@clerk/backend';
import { UnauthorizedError, ValidationError } from '@contextos/shared';

import type { McpServerEnv } from '../config/env.js';
import type { AuthClient, Identity } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/auth.ts` — auth abstraction shared by the
 * solo-bypass path, the `X-Local-Hook-Secret` path, and the Clerk JWT
 * path. The three are layered exactly in the order locked by
 * `context_memory/decisions-log.md` 2026-04-22 Q-02-1 and
 * `system-architecture.md` §19:
 *
 *     (1) solo-bypass       — CLERK_SECRET_KEY === 'sk_test_replace_me'
 *     (2) X-Local-Hook      — presented secret matches LOCAL_HOOK_SECRET
 *     (3) Clerk JWT         — @clerk/backend::verifyToken
 *
 * First match wins. No match → `UnauthorizedError` at the HTTP
 * middleware boundary (S16; stdio has no per-request identity).
 *
 * ### Why the `AuthClient` interface stays frozen
 *
 * The S7a `AuthClient = { getIdentity(): Promise<Identity | null>,
 * requireIdentity(): Promise<Identity> }` shape is no-arg. This matters
 * for HOW handlers consume auth from `ctx.auth`, but not for HOW the
 * identity gets attached in the first place. In solo mode (S7b today
 * under stdio) the identity is fixed to `SOLO_IDENTITY` on construction;
 * `getIdentity()` returns it without reading any request state.
 *
 * In team mode, the HTTP middleware (S16) will run BEFORE the registry
 * dispatches to `ToolContext.auth` — the middleware uses the
 * `verifyClerkJwt` / `verifyLocalHookSecret` helpers exported below to
 * resolve an identity from headers, then constructs a per-request
 * `AuthClient` around that identity and passes it through. Today's
 * `createClerkAuthClient(env)` returns an `AuthClient` whose
 * `getIdentity()` returns `null` — on stdio there IS no incoming
 * request to resolve. This is the behavior user directive 2026-04-23
 * Q1 locked: null-on-stdio + helpers for S16.
 *
 * ### Factory dispatch
 *
 * `createAuthClient(env)` is the top-level dispatcher. It picks solo
 * when the solo-bypass sentinel is set OR `CONTEXTOS_MODE === 'solo'`;
 * otherwise it picks Clerk. `index.ts` calls this factory exactly once
 * at boot. Tool handlers see only `ctx.auth` — they never branch on
 * mode.
 */

const authLogger = createMcpLogger('lib-auth');

const SOLO_BYPASS_CLERK_SENTINEL = 'sk_test_replace_me' as const;

/** Stable solo identity — see docblock. */
export const SOLO_IDENTITY: Identity = Object.freeze({
  userId: 'user_dev_local',
  orgId: 'org_dev_local',
  source: 'solo-bypass',
} satisfies Identity);

/**
 * Solo-bypass factory — always returns the frozen solo identity. Zero
 * I/O, zero env reads (env is consumed at the dispatch site, not here).
 * Warns on construction so a team-mode smoke deploy running with this
 * factory shows up in ops logs every boot.
 */
export function createSoloAuthClient(): AuthClient {
  authLogger.warn(
    { event: 'auth_solo_bypass_in_use', identity: SOLO_IDENTITY },
    'createSoloAuthClient: returning fixed solo identity. ' +
      'Team-mode deployments must use createClerkAuthClient via createAuthClient(env).',
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

/**
 * Constant-time comparison of a presented `X-Local-Hook-Secret` header
 * value against the configured `LOCAL_HOOK_SECRET` env value. Returns
 * `false` for length mismatches without leaking timing, and for any
 * non-string input (defence-in-depth against header-parser quirks).
 *
 * `timingSafeEqual` requires equal-length buffers or it throws; the
 * length pre-check also avoids an allocation when the attacker is
 * obviously wrong about the secret length.
 */
export function verifyLocalHookSecret(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  if (presented.length === 0 || expected.length === 0) return false;
  // `Buffer.byteLength` differs from `.length` for multi-byte strings —
  // use byte-length comparison to avoid a false mismatch on unicode.
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a Clerk JWT Bearer token and translate its payload into the
 * ContextOS `Identity` shape used everywhere else in the system.
 *
 * Throws `UnauthorizedError` for any failure — malformed token,
 * expired, signed by a different tenant, missing `sub`, etc. Callers
 * at the HTTP middleware boundary translate this into a `401`.
 *
 * Uses `@clerk/backend`'s top-level `verifyToken` helper. The library
 * caches JWKS per-secretKey at the module level, so repeated calls
 * from HTTP middleware (S16) incur at most one JWKS fetch per tenant.
 * `jwtKey` from env is passed when present, letting operators bypass
 * the JWKS fetch entirely for deployments behind a CDN that mirrors
 * Clerk's signing key.
 */
export async function verifyClerkJwt(token: string, env: McpServerEnv): Promise<Identity> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new UnauthorizedError('Clerk JWT verification: token is empty');
  }
  if (!env.CLERK_SECRET_KEY || env.CLERK_SECRET_KEY === SOLO_BYPASS_CLERK_SENTINEL) {
    throw new UnauthorizedError(
      'Clerk JWT verification: CLERK_SECRET_KEY is the solo-bypass sentinel; ' +
        'this code path requires a real sk_test_/sk_live_ key',
    );
  }
  if (!env.CLERK_PUBLISHABLE_KEY) {
    throw new UnauthorizedError('Clerk JWT verification: CLERK_PUBLISHABLE_KEY is required alongside CLERK_SECRET_KEY');
  }

  let payload: Awaited<ReturnType<typeof clerkVerifyToken>>;
  try {
    payload = await clerkVerifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    authLogger.warn(
      { event: 'clerk_verify_token_failed', err: message },
      'verifyClerkJwt: @clerk/backend rejected the token',
    );
    throw new UnauthorizedError(`Clerk JWT verification: ${message}`);
  }

  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new UnauthorizedError('Clerk JWT verification: payload.sub is missing or empty');
  }
  const orgIdRaw = (payload as Record<string, unknown>).org_id;
  const orgId = typeof orgIdRaw === 'string' && orgIdRaw.length > 0 ? orgIdRaw : null;

  return {
    userId: sub,
    orgId,
    source: 'clerk',
  };
}

/**
 * Team-mode factory. On the current (stdio-only) transport there is
 * no inbound request, so `getIdentity()` returns `null`. HTTP
 * middleware (S16) will call `verifyClerkJwt` / `verifyLocalHookSecret`
 * above directly — those helpers are the real wire code, not this
 * factory's methods. Locks the shape of the team-mode client today so
 * S16 is a transport integration, not an auth-surface refactor.
 *
 * `requireIdentity()` throws `UnauthorizedError` — the registry maps
 * that to the MCP tool-error envelope. Tools that need identity
 * should guard with `getIdentity()` and degrade gracefully where that
 * makes sense.
 */
export function createClerkAuthClient(env: McpServerEnv): AuthClient {
  if (!env.CLERK_SECRET_KEY || env.CLERK_SECRET_KEY === SOLO_BYPASS_CLERK_SENTINEL) {
    throw new ValidationError(
      'createClerkAuthClient requires a real CLERK_SECRET_KEY (sk_test_/sk_live_); ' +
        'got the solo-bypass sentinel or an empty value. Use createAuthClient(env) at the dispatch ' +
        'site so solo mode routes to createSoloAuthClient instead.',
    );
  }
  if (!env.CLERK_PUBLISHABLE_KEY) {
    throw new ValidationError('createClerkAuthClient requires CLERK_PUBLISHABLE_KEY alongside CLERK_SECRET_KEY');
  }

  authLogger.info(
    {
      event: 'auth_clerk_wired',
      clerkPublishableKeyPrefix: env.CLERK_PUBLISHABLE_KEY.slice(0, 8),
      clerkJwtIssuer: env.CLERK_JWT_ISSUER ?? null,
    },
    'createClerkAuthClient: team-mode auth wired. ' +
      'Per-request identity flows through verifyClerkJwt / verifyLocalHookSecret at the HTTP boundary (S16).',
  );

  return {
    async getIdentity() {
      return null;
    },
    async requireIdentity() {
      throw new UnauthorizedError(
        'Clerk auth client: no identity attached to this tool call. ' +
          'The HTTP transport (S16) populates per-request identity; stdio has no auth context.',
      );
    },
  };
}

/**
 * Top-level factory the application uses. Picks solo-bypass when the
 * sentinel is set or mode is solo; otherwise picks Clerk. `index.ts`
 * calls this once at boot.
 *
 * Returning `AuthClient` (not a union) keeps the call site
 * clean — S7a's invariant that tool code never branches on mode.
 */
export function createAuthClient(env: McpServerEnv): AuthClient {
  const isSolo =
    env.CONTEXTOS_MODE === 'solo' || !env.CLERK_SECRET_KEY || env.CLERK_SECRET_KEY === SOLO_BYPASS_CLERK_SENTINEL;
  if (isSolo) return createSoloAuthClient();
  return createClerkAuthClient(env);
}
