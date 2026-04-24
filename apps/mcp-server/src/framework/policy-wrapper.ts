import type { IdempotencyKey } from './idempotency.js';

/**
 * Policy-evaluation primitives shared by the registry, the
 * `PolicyClient` interface (see `tool-context.ts`), and every lib
 * module that wraps / implements a policy check.
 *
 * `system-architecture.md` §5 + §16 pattern 1 say the Policy Engine
 * is evaluated at every tool call — both PreToolUse and PostToolUse.
 * The only way to make that contract non-negotiable is to enforce it
 * inside the registration framework: a handler has no way to opt
 * out because it never sees an unwrapped call path. The registry
 * calls `ctx.deps.policy.evaluate(...)` before and after every
 * handler invocation; the `PolicyClient` interface and this file's
 * primitives (`PolicyInput`, `PolicyResult`, `PolicyCheck`) are the
 * common vocabulary those two sides speak.
 *
 * S7a moved the dev-null stand-in and its WARN log (previously
 * exported here as `devNullPolicyCheck` / `logDevNullPolicyInUse`)
 * to `lib/policy.ts`, behind `createDevNullPolicyClient()`. That is
 * consistent with the user-directive constraint that every lib
 * module expose a typed factory, never a module-level singleton
 * that tool code could accidentally import directly.
 */

export type PolicyDecision = 'allow' | 'deny';

export interface PolicyInput {
  readonly toolName: string;
  readonly sessionId: string;
  readonly idempotencyKey: IdempotencyKey;
  /** The validated tool input, available so policies can match on shape. */
  readonly input: unknown;
  /** `'pre'` or `'post'` — mirrors the Claude Code hook phase. */
  readonly phase: 'pre' | 'post';
  /**
   * Project scope for the evaluation, if known. Additive-optional slot
   * landed in S14 (user sign-off 2026-04-24) — closes the S7b deferral
   * note at `lib/policy.ts` that flagged the cache-key upgrade from the
   * `'all'` sentinel to `Map<projectId, …>` as "awaits the first caller
   * that has a real projectId". Existing auto-wrap callers (registry
   * pre/post hooks) omit this field and fall back to a `__global__`
   * cache entry; S14's `check_policy` tool supplies the real value.
   * Additive-only edit — no behavioural change for existing callers.
   */
  readonly projectId?: string;
}

export interface PolicyResult {
  readonly decision: PolicyDecision;
  readonly reason: string;
  readonly matchedRuleId: string | null;
}

/**
 * Abstraction the registry calls before and after every handler
 * invocation. S5 injects `devNullPolicyCheck`; S7b replaces it with
 * the cache-backed `evaluatePolicy` from `lib/policy.ts`.
 */
export type PolicyCheck = (req: PolicyInput) => Promise<PolicyResult>;

/**
 * Error thrown when the policy engine denies a call. The registry
 * translates this into the MCP tool-return shape `{ isError: true,
 * content: [...] }` so clients see a structured refusal rather than a
 * silent success + empty body. Handlers never see this error — it
 * is caught at the registry boundary.
 */
export class PolicyDenyError extends Error {
  public readonly toolName: string;
  public readonly reason: string;
  public readonly matchedRuleId: string | null;
  constructor(toolName: string, reason: string, matchedRuleId: string | null) {
    super(`policy denied '${toolName}': ${reason}`);
    this.name = 'PolicyDenyError';
    this.toolName = toolName;
    this.reason = reason;
    this.matchedRuleId = matchedRuleId;
  }
}
