import type { Logger } from '@contextos/shared';

import type { IdempotencyKey } from './idempotency.js';

/**
 * Frozen ToolContext shape for the entire Module 02 tool surface.
 *
 * DESIGN LOCK (2026-04-23, S7a): the member list below is the
 * authoritative list of per-call dependencies a tool handler may
 * consume. S7a builds the first four implementations (db, logger,
 * auth, policy); S7c fills in the remaining slots (featurePack,
 * contextPack, runRecorder, sqliteVec, graphify). Stub factories
 * live today in the corresponding `src/lib/*.ts` file so the
 * filesystem shape is locked and S7c is a function-body change,
 * not a file addition.
 *
 * Why freeze now: every tool shipped in S7b..S15 will type-check
 * against this shape. Growing the shape mid-module forces every
 * already-landed tool to be revisited for the new slot; shrinking
 * it is even worse because test-stubs would reference absent
 * fields. One shape, one release.
 *
 * Why factories, not singletons (user S7a directive): each lib
 * module exports `createXxxClient(deps)` — never a module-level
 * exported instance. The factory pattern lets:
 *   - `index.ts` decide mode dispatch exactly once at boot
 *     (see `createSoloAuthClient` vs the forthcoming
 *     `createClerkAuthClient`);
 *   - tests instantiate fresh per-suite clients with fixture-
 *     owned state (temp SQLite files, in-memory fakes);
 *   - S7b swap `createPolicyClient` from the dev-null shim to
 *     the cache-backed `lib/policy.ts::evaluatePolicy` without
 *     touching a single call site.
 *
 * Why tools use `ctx.now()`, not `new Date()` (user S7a
 * directive): a single `now()` entry point lets tests inject a
 * frozen clock, cuts real-clock flakiness, and keeps the
 * server timezone-safe — the handler never calls the global
 * `Date()` constructor. A test in
 * `__tests__/unit/tools/_no-raw-date.test.ts` greps the
 * `src/tools/**` tree and fails CI if any tool file contains
 * `new Date(`.
 */

// ---------------------------------------------------------------------------
// Lib-client interfaces.
// Each of these is implemented in `apps/mcp-server/src/lib/<name>.ts`.
// Interfaces live here (not in the lib file) so `tool-context.ts` is the
// single grep target for "what does a handler see?" and so individual lib
// files can evolve their internals freely without import cycles.
// ---------------------------------------------------------------------------

/** Handle on the Drizzle DB and its lifecycle. Implemented in `lib/db.ts`. */
export interface DbClient {
  /**
   * The Drizzle instance, already bound to the mode-specific driver
   * (@contextos/db's SQLite + better-sqlite3 or Postgres + postgres.js).
   * Typed as `unknown` here to avoid baking the driver choice into the
   * ToolContext interface; `lib/db.ts` re-exports a typed version for
   * lib-internal consumers that need it.
   */
  readonly db: unknown;
  /** Closes the underlying connection. Idempotent. */
  close(): Promise<void>;
}

/** Caller identity. Returned by `AuthClient.getIdentity` / `requireIdentity`. */
export interface Identity {
  readonly userId: string;
  readonly orgId: string | null;
  /** How the identity was resolved — audit trail. */
  readonly source: 'solo-bypass' | 'clerk' | 'local-hook';
}

/**
 * Auth abstraction. The solo-bypass module (`createSoloAuthClient`)
 * and the Clerk-backed module (`createClerkAuthClient`, landing in
 * S7b) both satisfy this interface. Tool code never branches on mode
 * — `index.ts` picks the factory once and the handler uses whatever
 * it gets through `ctx.auth`.
 */
export interface AuthClient {
  /** Returns the current identity, or null if no caller is attached. */
  getIdentity(): Promise<Identity | null>;
  /**
   * Like `getIdentity` but throws `UnauthorizedError` when missing.
   * Tools that strictly require an identity call this; tools that
   * optionally customise behaviour (e.g. per-user context) call
   * `getIdentity` and branch on null.
   */
  requireIdentity(): Promise<Identity>;
}

/** Policy evaluation, as consumed by tools after the registry-level wrapper. */
export interface PolicyClient {
  /**
   * Raw policy evaluation — usually tools do not call this directly
   * because the registry already wraps every call in pre/post policy
   * checks. Exposed here for tools that need to probe a hypothetical
   * tool call (e.g. `record_decision` asking 'would an agent be
   * allowed to run write_file under the current policy?').
   */
  evaluate(input: {
    readonly toolName: string;
    readonly phase: 'pre' | 'post';
    readonly sessionId: string;
    readonly input: unknown;
    readonly idempotencyKey: IdempotencyKey;
  }): Promise<{ decision: 'allow' | 'deny'; reason: string; matchedRuleId: string | null }>;
}

/** Feature-Pack store. Implemented (stub) in `lib/feature-pack.ts`, real impl in S7c. */
export interface FeaturePackStore {
  get(args: { projectSlug: string; filePath?: string }): Promise<unknown>;
  list(args: { projectSlug: string }): Promise<ReadonlyArray<unknown>>;
  upsert(pack: unknown): Promise<unknown>;
}

/**
 * Context-Pack store. Implemented (stub) in `lib/context-pack.ts`.
 *
 * Design note (user S7a directive Q3): `write` accepts the embedding
 * as a `Float32Array` or `null` — never computes one. Embedding
 * generation is Module 04's responsibility. A `null` embedding is a
 * first-class value (the pack is still stored for text-search
 * fallback); the store never calls an embedding model.
 */
export interface ContextPackStore {
  write(pack: unknown, embedding: Float32Array | null): Promise<unknown>;
  read(runId: string): Promise<unknown>;
  list(filter: { projectSlug?: string; runId?: string; limit?: number }): Promise<ReadonlyArray<unknown>>;
}

/**
 * Run-recorder. Implemented (stub) in `lib/run-recorder.ts`.
 *
 * Design note (user S7a directive Q2): the `runId: string | null`
 * nullable invariant (§4.3 — PreToolUse can fire before a run
 * exists) is handled INSIDE this module. Tool code passes whatever
 * it has; the recorder's internals translate `null` → SQL NULL on
 * insert. Call sites never branch on `if (runId)`.
 */
export interface RunRecorder {
  record(args: {
    runId: string | null;
    toolName: string;
    phase: 'pre' | 'post';
    sessionId: string;
    idempotencyKey: IdempotencyKey;
    input: unknown;
    output?: unknown;
    decision?: 'allow' | 'deny';
    reason?: string | null;
  }): Promise<void>;
}

/**
 * sqlite-vec client. Implemented (stub) in `lib/sqlite-vec.ts`.
 *
 * User constraint: this is a DOMAIN-shaped API, not a pass-through
 * query executor. `searchSimilarPacks(query)` is the right shape;
 * `run(sql, params)` is not. Future domain methods slot in here,
 * keeping SQL out of the handlers.
 */
export interface SqliteVecClient {
  searchSimilarPacks(query: {
    readonly embedding: Float32Array;
    readonly k: number;
    readonly filter?: { readonly projectSlug?: string };
  }): Promise<
    ReadonlyArray<{
      readonly packId: string;
      readonly distance: number;
    }>
  >;
}

/**
 * graphify client. Implemented (stub) in `lib/graphify.ts`.
 *
 * User constraint: expose domain-shaped ops, not query executors.
 * Module 05 defines the full graph surface; S7c lands the first
 * domain method as a stub so the ctx slot is reserved.
 */
export interface GraphifyClient {
  expandContext(args: { readonly runId: string; readonly depth: number }): Promise<{
    readonly nodes: ReadonlyArray<unknown>;
    readonly edges: ReadonlyArray<unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// Aggregated shapes.
// ---------------------------------------------------------------------------

/**
 * The lib-client bag. Constructed ONCE at boot in `index.ts` by
 * wiring the per-module factories, then passed to `ToolRegistry` at
 * construction time. Every `handleCall` spreads this bag into the
 * per-call ctx that handlers see.
 */
export interface ContextDeps {
  readonly db: DbClient;
  readonly logger: Logger;
  readonly auth: AuthClient;
  readonly policy: PolicyClient;
  readonly featurePack: FeaturePackStore;
  readonly contextPack: ContextPackStore;
  readonly runRecorder: RunRecorder;
  readonly sqliteVec: SqliteVecClient;
  readonly graphify: GraphifyClient;
}

/** Per-call fields the registry populates for every invocation. */
export interface PerCallContext {
  readonly toolName: string;
  readonly sessionId: string;
  /** Unique id for this tool invocation. Distinct from `sessionId`. */
  readonly requestId: string;
  readonly receivedAt: Date;
  readonly idempotencyKey: IdempotencyKey;
  /**
   * Clock injection. Tool handlers call this instead of `new Date()`
   * so tests can inject a frozen clock and the tool code is entirely
   * clock-agnostic. Enforced by `__tests__/unit/tools/_no-raw-date.test.ts`.
   */
  readonly now: () => Date;
}

/** What every tool handler receives as its second argument. Frozen shape. */
export type ToolContext = ContextDeps & PerCallContext;
