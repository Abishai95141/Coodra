import { type DbHandle, postgresSchema, sqliteSchema } from '@contextos/db';
import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
  IsolatedCircuitError,
  TaskCancelledError,
  TimeoutStrategy,
  timeout,
  wrap,
} from 'cockatiel';
import { and, eq } from 'drizzle-orm';
import picomatch from 'picomatch';

import type { PolicyCheck, PolicyInput, PolicyResult } from '../framework/policy-wrapper.js';
import type { PolicyClient } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/policy.ts` — cache-first policy evaluator
 * backed by the `policies` + `policy_rules` DB tables, wrapped in a
 * cockatiel timeout-then-breaker fuse, fail-open on every error path.
 *
 * Wiring:
 *   - `src/index.ts` calls `createPolicyClient({ db, clock? })` once
 *     at boot with the `DbHandle` from `createDbClient(...).asInternalHandle()`.
 *   - The registry's auto-wrap (see `framework/tool-registry.ts::handleCall`)
 *     calls `ctx.deps.policy.evaluate(...)` in pre AND post phase for
 *     every tool call. The S7a dev-null stand-in is gone; this real
 *     evaluator is the only `PolicyClient` production wires.
 *   - `createPolicyClientFromCheck` (for tests) + `createDevNullPolicyClient`
 *     (for the anonymous/always-allow test fixture) stay exported so
 *     the existing test suite keeps compiling.
 *
 * Fail-open contract (`system-architecture.md` §7):
 *
 *   Any of the following returns `{ decision: 'allow',
 *   reason: 'policy_check_unavailable', matchedRuleId: null }`:
 *     - breaker is open                 (cockatiel `BrokenCircuitError`)
 *     - breaker is isolated             (cockatiel `IsolatedCircuitError`)
 *     - per-call timeout tripped        (cockatiel `TaskCancelledError`)
 *     - DB throws a non-breaker error   (any other Error)
 *     - rule-cache refill failed mid-eval
 *
 *   The only `deny` ever returned is from a rule that explicitly
 *   matched with `decision = 'deny'`. §7 defines this as the only
 *   intentional block.
 *
 * Cache (`system-architecture.md` §5: Policy Evaluation → AP, cache-first):
 *
 *   The evaluator keeps an in-process rule cache with a 60s TTL. At
 *   Module 02 solo-mode scale (<10 rules across a single project)
 *   this is effectively a global cache keyed by the synthetic key
 *   `'all'`. When S14's `check_policy` tool lands and passes per-
 *   project context, the cache upgrades to `Map<projectId, …>`
 *   without changing the evaluator's public shape.
 *
 * Audit writes (`system-architecture.md` §4.3):
 *
 *   The registry auto-wrap call does NOT have `projectId`,
 *   `agentType`, or `runId` in its `PolicyInput` — those fields are
 *   required (NOT NULL FK) on `policy_decisions`. Writing defaults
 *   from the auto-wrap path would (a) require a synthetic `projects`
 *   row and (b) flood the audit log with per-registry-call rows that
 *   are not the `check_policy` hook events §4.3 actually cares about.
 *   So S7b exports `recordPolicyDecision(db, context)` as the wire
 *   code for the audit write; S14's `check_policy` tool is the
 *   first call site that will invoke it (with full hook-event
 *   context via `setImmediate` + ON CONFLICT DO NOTHING). Keeping the
 *   helper here means S14 imports from the same lib module as the
 *   evaluator, preserving single-source-of-truth for the policy
 *   engine surface.
 *
 * Factory style (user S7a directive): no module-level `PolicyClient`
 * is exported. Tests build their own via `createPolicyClientFromCheck`.
 */

const policyLogger = createMcpLogger('lib-policy');

/** `pd:{sessionId}:{toolName}:{eventType}` per `system-architecture.md` §4.3. */
export function buildPolicyDecisionIdempotencyKey(args: {
  readonly sessionId: string;
  readonly toolName: string;
  readonly eventType: string;
}): string {
  return `pd:${args.sessionId}:${args.toolName}:${args.eventType}`;
}

// ---------------------------------------------------------------------------
// Test-supporting factories (kept from S7a — test files import these).
// ---------------------------------------------------------------------------

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
      const req: PolicyInput = {
        toolName: input.toolName,
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
        phase: input.phase,
        // S14 additive-optional — pass through when the caller supplies
        // it so PolicyCheck stubs used by tests can branch on
        // projectId without needing their own wiring.
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
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
 * Deterministic always-allow `PolicyCheck` — the S7a stand-in. Kept
 * exported in S7b because `__tests__/helpers/fake-deps.ts` still uses
 * it as the default for tests that don't care about policy.
 */
export const devNullPolicyCheck: PolicyCheck = async () => ({
  decision: 'allow',
  reason: 'dev-null: policy engine not wired (test stand-in)',
  matchedRuleId: null,
});

/**
 * Test-only factory — returns a `PolicyClient` whose `.evaluate` is
 * `allow` for any input. The WARN that S7a emitted from this factory
 * at construction is gone; production no longer goes through this
 * path. `__tests__/helpers/fake-deps.ts` uses it silently.
 */
export function createDevNullPolicyClient(): PolicyClient {
  return createPolicyClientFromCheck(devNullPolicyCheck);
}

// ---------------------------------------------------------------------------
// Real evaluator.
// ---------------------------------------------------------------------------

/** Match-value a rule uses to compare against PolicyInput.phase. */
const PHASE_TO_EVENT_TYPE: Readonly<Record<'pre' | 'post', string>> = {
  pre: 'PreToolUse',
  post: 'PostToolUse',
};

/** Tunables surfaced for tests that need to override them. */
export interface CreatePolicyClientOptions {
  /** `DbHandle` — usually `dbClient.asInternalHandle()` from index.ts. */
  readonly db: DbHandle;
  /** Clock injection for deterministic cache-TTL tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Cache TTL override (tests only). Defaults to 60s per §5. */
  readonly cacheTtlMs?: number;
  /** Per-call timeout fuse. Defaults to 100ms per user S7b directive. */
  readonly timeoutMs?: number;
  /** Breaker threshold override. Defaults to 5 consecutive failures per §7. */
  readonly breakerThreshold?: number;
  /** Breaker half-open probe delay. Defaults to 30_000ms per §7. */
  readonly breakerHalfOpenMs?: number;
}

/** Internal cached rule with its compiled path matcher. */
interface CompiledRule {
  readonly id: string;
  readonly policyId: string;
  readonly priority: number;
  readonly matchEventType: string;
  readonly matchToolName: string;
  /** `null` = any path matches; otherwise the compiled picomatch result. */
  readonly matchPath: ((p: string) => boolean) | null;
  readonly matchAgentType: string | null;
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
}

interface CacheEntry {
  readonly rules: ReadonlyArray<CompiledRule>;
  readonly loadedAt: number;
}

const DEFAULTS = {
  CACHE_TTL_MS: 60_000,
  TIMEOUT_MS: 100,
  BREAKER_THRESHOLD: 5,
  BREAKER_HALF_OPEN_MS: 30_000,
} as const;

/** Coerce a DB rule row into a `CompiledRule` once at cache-load time. */
function compileRule(row: {
  id: string;
  policyId: string;
  priority: number;
  matchEventType: string;
  matchToolName: string;
  matchPathGlob: string | null;
  matchAgentType: string | null;
  decision: string;
  reason: string;
}): CompiledRule {
  const decision = row.decision === 'deny' ? 'deny' : 'allow';
  const matcher = row.matchPathGlob ? picomatch(row.matchPathGlob, { dot: false, nobrace: true }) : null;
  return {
    id: row.id,
    policyId: row.policyId,
    priority: row.priority,
    matchEventType: row.matchEventType,
    matchToolName: row.matchToolName,
    matchPath: matcher,
    matchAgentType: row.matchAgentType,
    decision,
    reason: row.reason,
  };
}

/**
 * Tool-name match: exact, or `'*'` wildcard, or a subset of picomatch
 * semantics (`tool_*`). Compiling a picomatch instance per rule on
 * the tool-name axis costs no more than ~100ns and keeps the match
 * logic symmetrical with the path axis.
 */
function toolNameMatches(rule: CompiledRule, toolName: string): boolean {
  if (rule.matchToolName === '*') return true;
  if (rule.matchToolName === toolName) return true;
  if (!rule.matchToolName.includes('*')) return false;
  return picomatch(rule.matchToolName, { dot: false, nobrace: true })(toolName);
}

/**
 * Derive a file-path-like string from the validated `toolInput` for
 * path-glob matching. This is deliberately loose — rules that don't
 * care about paths don't reach here. Returns the empty string when no
 * path candidate is present; picomatch returns `false` on that,
 * meaning "rule does not apply" (matches the documented gotcha).
 */
function extractPath(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of ['filePath', 'file_path', 'path']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

/**
 * First-match-wins rule evaluation. `rules` is assumed to be sorted
 * by priority ASC (the DB query does this; the cache preserves the
 * order). Returns the first rule whose axes all match, or `null` if
 * none apply (caller defaults to `allow`).
 */
export function evaluateRules(
  rules: ReadonlyArray<CompiledRule>,
  input: Pick<PolicyInput, 'phase' | 'toolName' | 'input'>,
): CompiledRule | null {
  const eventType = PHASE_TO_EVENT_TYPE[input.phase];
  const path = extractPath(input.input);
  for (const rule of rules) {
    if (rule.matchEventType !== '*' && rule.matchEventType !== eventType) continue;
    if (!toolNameMatches(rule, input.toolName)) continue;
    if (rule.matchPath) {
      if (path.length === 0 || !rule.matchPath(path)) continue;
    }
    // agentType is not present in the registry auto-wrap PolicyInput;
    // rules scoped to a specific agent are skipped. Rules with `*` or
    // `null` agent apply to every auto-wrap call.
    if (rule.matchAgentType !== null && rule.matchAgentType !== '*') continue;
    return rule;
  }
  return null;
}

/**
 * SELECT active rules from both dialects' schemas, ordered for
 * first-match-wins. When `projectId` is supplied (S14 `check_policy`
 * path), rules are filtered via `policies.project_id = ?`; when
 * `null` (registry auto-wrap path prior to S14), the unfiltered
 * union of all active rules is returned — preserves pre-S14
 * behaviour for callers that still omit `projectId`.
 */
async function loadRules(db: DbHandle, projectId: string | null): Promise<ReadonlyArray<CompiledRule>> {
  if (db.kind === 'sqlite') {
    const where =
      projectId === null
        ? eq(sqliteSchema.policies.isActive, true)
        : and(eq(sqliteSchema.policies.isActive, true), eq(sqliteSchema.policies.projectId, projectId));
    const rows = await db.db
      .select({
        id: sqliteSchema.policyRules.id,
        policyId: sqliteSchema.policyRules.policyId,
        priority: sqliteSchema.policyRules.priority,
        matchEventType: sqliteSchema.policyRules.matchEventType,
        matchToolName: sqliteSchema.policyRules.matchToolName,
        matchPathGlob: sqliteSchema.policyRules.matchPathGlob,
        matchAgentType: sqliteSchema.policyRules.matchAgentType,
        decision: sqliteSchema.policyRules.decision,
        reason: sqliteSchema.policyRules.reason,
      })
      .from(sqliteSchema.policyRules)
      .innerJoin(sqliteSchema.policies, eq(sqliteSchema.policies.id, sqliteSchema.policyRules.policyId))
      .where(where)
      .orderBy(sqliteSchema.policyRules.priority);
    return rows.map(compileRule);
  }
  const where =
    projectId === null
      ? eq(postgresSchema.policies.isActive, true)
      : and(eq(postgresSchema.policies.isActive, true), eq(postgresSchema.policies.projectId, projectId));
  const rows = await db.db
    .select({
      id: postgresSchema.policyRules.id,
      policyId: postgresSchema.policyRules.policyId,
      priority: postgresSchema.policyRules.priority,
      matchEventType: postgresSchema.policyRules.matchEventType,
      matchToolName: postgresSchema.policyRules.matchToolName,
      matchPathGlob: postgresSchema.policyRules.matchPathGlob,
      matchAgentType: postgresSchema.policyRules.matchAgentType,
      decision: postgresSchema.policyRules.decision,
      reason: postgresSchema.policyRules.reason,
    })
    .from(postgresSchema.policyRules)
    .innerJoin(postgresSchema.policies, eq(postgresSchema.policies.id, postgresSchema.policyRules.policyId))
    .where(where)
    .orderBy(postgresSchema.policyRules.priority);
  return rows.map(compileRule);
}

const FAIL_OPEN_RESULT: PolicyResult = Object.freeze({
  decision: 'allow',
  reason: 'policy_check_unavailable',
  matchedRuleId: null,
});

function isCockatielFailOpen(err: unknown): boolean {
  return err instanceof BrokenCircuitError || err instanceof IsolatedCircuitError || err instanceof TaskCancelledError;
}

/**
 * Real policy evaluator. Wraps a cache-first DB read in a
 * cockatiel timeout + breaker fuse, returns fail-open on every
 * error path. The frozen `PolicyClient` interface (see
 * `framework/tool-context.ts`) is the only surface exposed to the
 * registry.
 */
export function createPolicyClient(options: CreatePolicyClientOptions): PolicyClient {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createPolicyClient requires an options object');
  }
  if (!options.db || typeof options.db !== 'object' || !('kind' in options.db)) {
    throw new TypeError('createPolicyClient: options.db must be a DbHandle from @contextos/db');
  }

  const now = options.now ?? (() => Date.now());
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULTS.CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.TIMEOUT_MS;
  const breakerThreshold = options.breakerThreshold ?? DEFAULTS.BREAKER_THRESHOLD;
  const breakerHalfOpenMs = options.breakerHalfOpenMs ?? DEFAULTS.BREAKER_HALF_OPEN_MS;

  const breaker = circuitBreaker(handleAll, {
    halfOpenAfter: breakerHalfOpenMs,
    breaker: new ConsecutiveBreaker(breakerThreshold),
  });
  const fuse = timeout(timeoutMs, TimeoutStrategy.Aggressive);
  const policy = wrap(fuse, breaker);

  // Per-projectId cache (S14 upgrade — closes the S7b deferral at
  // `lib/policy.ts`'s "cache keyed globally" comment). Callers that
  // supply `input.projectId` key their own slot; the registry
  // auto-wrap path (still projectId-less) falls back to the
  // `__global__` slot with every-project rules loaded, preserving
  // pre-S14 behaviour. Eviction is by TTL (60s) per §5; there is no
  // per-project invalidation API — team-mode NL Assembly will publish
  // one in Module 05.
  const GLOBAL_CACHE_KEY = '__global__';
  const cache = new Map<string, CacheEntry>();

  policyLogger.info(
    {
      event: 'policy_engine_wired',
      mode: options.db.kind === 'sqlite' ? 'solo' : 'team',
      cacheTtlMs,
      timeoutMs,
      breakerThreshold,
      breakerHalfOpenMs,
    },
    'createPolicyClient: policy engine wired (cache-first + timeout + breaker + fail-open).',
  );

  async function getRules(projectId: string | null): Promise<ReadonlyArray<CompiledRule>> {
    const key = projectId ?? GLOBAL_CACHE_KEY;
    const cached = cache.get(key);
    if (cached && now() - cached.loadedAt < cacheTtlMs) {
      return cached.rules;
    }
    const rules = await policy.execute(() => loadRules(options.db, projectId));
    cache.set(key, { rules, loadedAt: now() });
    return rules;
  }

  return {
    async evaluate(input) {
      const started = now();
      const projectId = input.projectId ?? null;
      let rules: ReadonlyArray<CompiledRule>;
      try {
        rules = await getRules(projectId);
      } catch (err) {
        const durationMs = now() - started;
        if (isCockatielFailOpen(err)) {
          policyLogger.warn(
            {
              event: 'policy_fail_open_breaker',
              tool: input.toolName,
              phase: input.phase,
              sessionId: input.sessionId,
              durationMs,
              reason: err instanceof Error ? err.name : 'unknown',
            },
            'policy fuse tripped (breaker open, isolated, or timeout); failing open',
          );
        } else {
          policyLogger.warn(
            {
              event: 'policy_fail_open_error',
              tool: input.toolName,
              phase: input.phase,
              sessionId: input.sessionId,
              durationMs,
              err: err instanceof Error ? err.message : String(err),
            },
            'policy DB read threw; failing open',
          );
        }
        return FAIL_OPEN_RESULT;
      }

      const matched = evaluateRules(rules, {
        phase: input.phase,
        toolName: input.toolName,
        input: input.input,
      });

      if (!matched) {
        return {
          decision: 'allow',
          reason: 'no_rule_matched',
          matchedRuleId: null,
        };
      }

      return {
        decision: matched.decision,
        reason: matched.reason,
        matchedRuleId: matched.id,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Audit write helper (called by S14's check_policy tool, NOT by evaluate()).
// Exported from the same module so there is one source of truth for the
// policy-engine surface. Kept module-level (not a PolicyClient method)
// because writing to `policy_decisions` requires projectId + agentType
// context the frozen PolicyClient interface does not expose.
// ---------------------------------------------------------------------------

export interface RecordPolicyDecisionArgs {
  /** NOT NULL FK to `projects.id`. S14's caller must supply. */
  readonly projectId: string;
  readonly sessionId: string;
  readonly agentType: string;
  readonly eventType: string;
  readonly toolName: string;
  /** JSON string of the tool input — caller controls truncation. */
  readonly toolInputSnapshot: string;
  readonly permissionDecision: 'allow' | 'deny';
  readonly reason: string;
  readonly matchedRuleId: string | null;
  /** Nullable FK — PreToolUse before a run exists writes NULL per §4.3. */
  readonly runId: string | null;
  /** UUID minter; defaults to `crypto.randomUUID()`. Exposed for tests. */
  readonly mintId?: () => string;
}

/**
 * Insert a row into `policy_decisions` using the locked idempotency
 * key `pd:{sessionId}:{toolName}:{eventType}` (§4.3). ON CONFLICT DO
 * NOTHING dedupes retries. Caller dispatches via `setImmediate(...)`
 * per Q-02-2; this function is synchronous-throwing so the caller's
 * `.catch()` sees the error.
 *
 * Returns `{ inserted }`:
 *   - `inserted: true` on first write.
 *   - `inserted: false` when the idempotency key already exists.
 * The distinction lets tests and observability count retry dedupes.
 */
export async function recordPolicyDecision(
  db: DbHandle,
  args: RecordPolicyDecisionArgs,
): Promise<{ readonly inserted: boolean }> {
  const id = (args.mintId ?? (() => globalThis.crypto.randomUUID()))();
  const idempotencyKey = buildPolicyDecisionIdempotencyKey({
    sessionId: args.sessionId,
    toolName: args.toolName,
    eventType: args.eventType,
  });

  const row = {
    id,
    idempotencyKey,
    runId: args.runId,
    sessionId: args.sessionId,
    projectId: args.projectId,
    agentType: args.agentType,
    eventType: args.eventType,
    toolName: args.toolName,
    toolInputSnapshot: args.toolInputSnapshot,
    permissionDecision: args.permissionDecision,
    matchedRuleId: args.matchedRuleId,
    reason: args.reason,
  };

  if (db.kind === 'sqlite') {
    const result = await db.db
      .insert(sqliteSchema.policyDecisions)
      .values(row)
      .onConflictDoNothing({ target: sqliteSchema.policyDecisions.idempotencyKey })
      .returning({ id: sqliteSchema.policyDecisions.id });
    return { inserted: result.length === 1 };
  }

  const result = await db.db
    .insert(postgresSchema.policyDecisions)
    .values(row)
    .onConflictDoNothing({ target: postgresSchema.policyDecisions.idempotencyKey })
    .returning({ id: postgresSchema.policyDecisions.id });
  return { inserted: result.length === 1 };
}
