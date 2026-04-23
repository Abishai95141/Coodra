import type { PolicyCheck, PolicyInput, PolicyResult } from '../framework/policy-wrapper.js';
import type { PolicyClient } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/policy.ts` — factory for the `PolicyClient`
 * wired into `ToolContext.policy`.
 *
 * The registry automatically wraps every tool call in a pre- and
 * post-phase policy evaluation by calling `ctx.policy.evaluate(...)`
 * (see `framework/tool-registry.ts`). Tool code rarely calls this
 * interface directly — the only current consumer is `check_policy`
 * (S14), which probes "would tool X be allowed for this input right
 * now?" without actually running X.
 *
 * S7a state: the returned client delegates to a `devNullPolicyCheck`
 * that always returns `{ decision: 'allow' }`. A WARN at construction
 * time surfaces the stand-in in every startup log so the dev-null
 * path cannot ship to team mode unnoticed. S7b replaces the
 * implementation with a cache-backed rule evaluator wrapped in a
 * cockatiel circuit breaker, and the factory call site in
 * `src/index.ts` is the single line that changes.
 *
 * Factory style (user S7a directive): no module-level `PolicyClient`
 * is exported. Tests build their own via `createPolicyClientFromCheck`
 * with a fake `PolicyCheck` that records calls.
 */

const policyLogger = createMcpLogger('lib-policy');

/**
 * Build a `PolicyClient` by wrapping a lower-level `PolicyCheck` —
 * the narrow callback that takes `PolicyInput` and returns
 * `PolicyResult`. Tests use this to inject tracking / deny / throw
 * stubs without having to implement the full `PolicyClient`
 * interface every time.
 */
export function createPolicyClientFromCheck(check: PolicyCheck): PolicyClient {
  if (typeof check !== 'function') {
    throw new TypeError('createPolicyClientFromCheck: check must be a PolicyCheck function');
  }
  return {
    async evaluate(input) {
      // `PolicyClient.evaluate` and `PolicyCheck` have a
      // type-compatible input/output (see `tool-context.ts` and
      // `policy-wrapper.ts`); the forwarded call preserves every
      // field without translation.
      const req: PolicyInput = {
        toolName: input.toolName,
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
        phase: input.phase,
      };
      const out: PolicyResult = await check(req);
      return {
        decision: out.decision,
        reason: out.reason,
        matchedRuleId: out.matchedRuleId,
      };
    },
  };
}

/**
 * Deterministic always-allow `PolicyCheck` — the S7a stand-in. The
 * reason string carries the slice marker so a query against
 * `policy_decisions` in a later slice can identify rows produced
 * during the dev-null era.
 */
export const devNullPolicyCheck: PolicyCheck = async () => ({
  decision: 'allow',
  reason: 'dev-null: policy engine not yet wired (S7a stand-in)',
  matchedRuleId: null,
});

/**
 * S7a factory — always returns the dev-null client wired behind the
 * `PolicyClient` interface. The WARN is emitted once at construction
 * so multiple imports (e.g. via a test helper + production code in
 * the same process) do not flood the log. S7b swaps this factory at
 * the `src/index.ts` call site; no handler code changes.
 */
export function createDevNullPolicyClient(): PolicyClient {
  policyLogger.warn(
    {
      event: 'policy_dev_null_in_use',
      module: '@contextos/mcp-server',
      slice: 'S7a',
    },
    'createDevNullPolicyClient: tool calls will always be allowed. ' +
      'Replace with the cache-backed evaluator (S7b) before team-mode deployment.',
  );
  return createPolicyClientFromCheck(devNullPolicyCheck);
}
