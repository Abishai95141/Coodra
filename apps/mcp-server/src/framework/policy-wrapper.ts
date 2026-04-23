import { createLogger } from '@contextos/shared';

import type { IdempotencyKey } from './idempotency.js';

/**
 * Automatic policy-check wrapper for every registered tool.
 *
 * `system-architecture.md` §5 + §16 pattern 1 say the Policy Engine
 * is evaluated at every tool call — both PreToolUse and PostToolUse.
 * The only way to make that contract non-negotiable is to enforce it
 * inside the registration framework: a handler has no way to opt
 * out because it never sees an unwrapped call path. The registry
 * wraps the caller-supplied handler at registration time and routes
 * every invocation through this module.
 *
 * **S5 scope:** the real policy evaluator (cache, fail-open breaker,
 * async `policy_decisions` insert) lands in S7b as
 * `lib/policy.ts::evaluatePolicy()`. In S5 we inject a deterministic
 * always-allow stand-in (`devNullPolicyCheck`) with the same
 * signature, so the wrapper contract is locked and S7b is a single-
 * file swap that nobody else has to coordinate on.
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

const wrapperLogger = createLogger('mcp-server.policy-wrapper');

/**
 * S5 stand-in: always returns `allow` with a deterministic reason.
 * Not exported as the default — the registry takes a policy-check
 * explicitly, so swapping it for the real evaluator in S7b is a
 * single call-site change (in `index.ts`).
 *
 * The WARN log line makes sure we never ship this to production by
 * accident — every startup that wires this stand-in leaves a paper
 * trail in stderr.
 */
export const devNullPolicyCheck: PolicyCheck = async (req) => {
  return {
    decision: 'allow',
    reason: 'dev-null: policy engine not yet wired (S5 walking skeleton)',
    matchedRuleId: null,
  } satisfies PolicyResult;
};

export function logDevNullPolicyInUse(): void {
  wrapperLogger.warn(
    {
      event: 'policy_dev_null_in_use',
      module: '@contextos/mcp-server',
      slice: 'S5',
    },
    'devNullPolicyCheck is wired — tool calls will always be allowed. ' +
      'Replace with lib/policy.ts::evaluatePolicy (S7b) before team-mode deployment.',
  );
}

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
