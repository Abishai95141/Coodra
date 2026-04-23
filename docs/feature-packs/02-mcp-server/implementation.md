# Module 02 — MCP Server — Implementation Plan

> Follow top-to-bottom. Each step lists the files it creates/modifies and the commit it belongs to. Every commit that bumps a package version amends `External api and library reference.md` in the same commit — amendment B, carried forward from Module 01. 23 slices total (S7 was split into S7a/S7b/S7c along trust boundaries per addition A of the approved plan).

## Prerequisites (one-time, before S1)

- Module 01 merged on `main` at `88aac10`.
- Node ≥ 22.16.0, pnpm ≥ 10.33.0, git ≥ 2.40 (already required by Module 01).
- **Docker Desktop running** on the local machine. Required from S17 onward for the `testcontainers`-backed Postgres integration test. The daemon is already a GitHub-hosted `ubuntu-latest` runner default, so CI needs no config change for it.
- Repo-local git identity already set by Module 01 (verified: Abishai / abishai95141@gmail.com).

Clerk keys are **not** required to build or test Module 02. The solo-bypass path runs with zero real keys; the Clerk middleware is wired against env-var reads and is first live-tested in Module 04 or the first real team-mode flip.

## Step sequence

### S1 — Module 02 Feature Pack spec (this commit)

**Files:** `docs/feature-packs/02-mcp-server/spec.md`, `docs/feature-packs/02-mcp-server/implementation.md` (this file), `docs/feature-packs/02-mcp-server/techstack.md`.

**Commit:** `docs(02-mcp-server): spec, implementation plan, techstack`.

### S2 — Context memory handover

Archive the Module 01 `current-session.md` to `context_memory/sessions/2026-04-22-module-01.md` and open a fresh `current-session.md` for Module 02. Backfill its Log section with the S1 entries that already happened. Append to `context_memory/decisions-log.md` one entry per approved Q / addition from the Module 02 plan approval (Q-02-1 through Q-02-7, additions A/B/C/D). Update `context_memory/pending-user-actions.md` — **Docker Desktop** moves from "needed before Module 02" to "due now"; **Clerk publishable + secret keys** noted as "needed by Module 04 or first team-mode flip, whichever is earlier". `blockers.md` stays empty.

**Files:** `context_memory/sessions/2026-04-22-module-01.md` (new archive), `context_memory/current-session.md` (rewritten for Module 02), `context_memory/decisions-log.md` (appended), `context_memory/pending-user-actions.md` (edited).

**Commit:** `chore(context-memory): archive module-01 session, begin module-02`.

### S3 — DB: four new tables + `content_excerpt` column

Add `policies`, `policy_rules`, `policy_decisions`, `feature_packs` to both `packages/db/src/schema/sqlite.ts` and `packages/db/src/schema/postgres.ts`. Append `content_excerpt text NOT NULL default ''` to `context_packs` on both sides (default is empty string only for the migration; the application layer writes the real value on every insert). Extend the dialect-parity test to cover all four new tables. Add indices per `system-architecture.md §4.3`:

```sql
CREATE INDEX policy_rules_policy_priority_idx ON policy_rules (policy_id, priority ASC);
CREATE INDEX policy_decisions_session_idx     ON policy_decisions (session_id, created_at DESC);
CREATE UNIQUE INDEX policy_decisions_idemp_idx ON policy_decisions (idempotency_key);
CREATE UNIQUE INDEX feature_packs_slug_idx    ON feature_packs (slug);
```

Generate `0001_module_02_mcp_server.sql` for both dialects:

```bash
pnpm --filter @contextos/db exec drizzle-kit generate --config=drizzle.sqlite.config.ts
pnpm --filter @contextos/db exec drizzle-kit generate --config=drizzle.postgres.config.ts
```

The produced SQL is committed.

**Files:** `packages/db/src/schema/sqlite.ts`, `packages/db/src/schema/postgres.ts`, `packages/db/drizzle/sqlite/0001_*.sql`, `packages/db/drizzle/postgres/0001_*.sql`, `packages/db/drizzle/sqlite/meta/*`, `packages/db/drizzle/postgres/meta/*`, `packages/db/__tests__/unit/schema-parity.test.ts` (extended).

**No reference updates** — `drizzle-orm` and `drizzle-kit` are unchanged from Module 01.

**Commit:** `feat(db): policies, policy_rules, policy_decisions, feature_packs tables`.

### S4 — DB: sqlite-vec virtual table + pgvector HNSW index (hand-edited + locked)

Hand-append to `packages/db/drizzle/sqlite/0001_*.sql`:

```sql
-- @preserve-begin hand-written
CREATE VIRTUAL TABLE context_packs_vec USING vec0(
  context_pack_id TEXT PRIMARY KEY,
  summary_embedding float[384] distance_metric=cosine
);
-- @preserve-end
```

Hand-append to `packages/db/drizzle/postgres/0001_*.sql`:

```sql
-- @preserve-begin hand-written
CREATE INDEX context_packs_embedding_hnsw ON context_packs
  USING hnsw (summary_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
-- @preserve-end
```

Record the sha256 of each block in `packages/db/migrations.lock.json` with this shape:

```json
{
  "0001_module_02_mcp_server.sql": {
    "sqlite": { "context_packs_vec": "sha256:..." },
    "postgres": { "context_packs_embedding_hnsw": "sha256:..." }
  }
}
```

Add `packages/db/scripts/check-migration-lock.mjs` — extracts each `@preserve-begin / @preserve-end` block, recomputes sha256, diffs against `migrations.lock.json`, exits non-zero on mismatch. Wire it as `pnpm --filter @contextos/db run check:migration-lock` and add it as the first step of the `verify` CI job (before `lint`). Drop a `CI: migration lock integrity` reminder paragraph into `docs/DEVELOPMENT.md` explaining what to do if `drizzle-kit` regenerate overwrites a block.

Install `sqlite-vec@^0.1.9` as a dev dependency of `@contextos/db`. Wire `sqliteVec.load(db)` inside `createSqliteDb` immediately after the better-sqlite3 connection opens, wrapped in try/catch — on failure, log a structured `sqlite_vec_unavailable` warning and continue (the search-packs-nl LIKE fallback takes over).

Extend `packages/db/__tests__/integration/postgres-migrate.test.ts` to verify the HNSW index exists. Add `packages/db/__tests__/integration/sqlite-vec.test.ts` that loads the extension, creates the virtual table, inserts a 384-d vector, and performs a `MATCH` KNN query — assert the expected row is returned.

**Reference updates in the same commit** (amendment B):

- `External api and library reference.md` — `sqlite-vec` section: pin `^0.1.9`; add the `db.loadExtension(getLoadablePath())` snippet and the brute-force-KNN gotcha.

**Files:** `packages/db/drizzle/sqlite/0001_*.sql` (hand-append), `packages/db/drizzle/postgres/0001_*.sql` (hand-append), `packages/db/migrations.lock.json` (new), `packages/db/scripts/check-migration-lock.mjs` (new), `packages/db/package.json` (add `sqlite-vec`), `packages/db/src/client.ts` (extension-load branch), `packages/db/__tests__/integration/sqlite-vec.test.ts` (new), `packages/db/__tests__/integration/postgres-migrate.test.ts` (extended), `.github/workflows/ci.yml` (add `check:migration-lock` step), `docs/DEVELOPMENT.md` (migration-lock section), `External api and library reference.md`.

**Commit:** `feat(db): sqlite-vec virtual table + pgvector HNSW index for context_packs`.

### S5 — Bootstrap `apps/mcp-server` + tool-registration framework + `ping` walking skeleton

**Scope grew on 2026-04-23** per the user-approved S5 directive — S5 is now a full walking skeleton that proves every layer of the framework before S6+ ship the real tools. The previous S6 (tool-registration framework) and parts of S7a (env/logger infra) are folded into this slice, and a minimal `ping` tool lands to end-to-end-prove the pipeline.

**What lands in S5:**

- `apps/mcp-server/package.json` (private, `"type": "module"`, `bin`), `tsconfig.json` + `tsconfig.typecheck.json` (extends `../../tsconfig.base.json`), `vitest.config.ts`, `README.md`, `.env.example`, `.dockerignore`.
- Runtime deps pinned EXACT where protocol stability demands it: `@modelcontextprotocol/sdk@1.29.0` (no caret — MCP minor bumps can add required fields), `zod@^4.3.6` (matches shared), `@contextos/shared` + `@contextos/db` as workspace deps. The HTTP-transport deps (`hono`, `@hono/node-server`, `cockatiel`, `@clerk/backend`, `ajv`, `ajv-formats`) are deferred to S16 (HTTP transport) per the directive's "stdio-only in S5" constraint — installing them now would bloat the dev graph with unused code.
- `zod-to-json-schema` **dropped** in favour of Zod v4's built-in `z.toJSONSchema()`. Deviates from techstack.md's original `^3.25.2` pin; decision recorded in `decisions-log.md 2026-04-23`.
- `src/bootstrap/ensure-stderr-logging.ts` — side-effect module imported first in `src/index.ts`. Sets `CONTEXTOS_LOG_DESTINATION=stderr` before `@contextos/shared`'s logger module evaluates, so every transitively-loaded log call (including db's sqlite-vec loader in future slices) routes to fd 2.
- `src/config/env.ts` — zod-validated, typed `env` singleton, parsed once at module load via `@contextos/shared::parseEnv`. The ONE module in mcp-server allowed to read `process.env`. Strictness rules (team-mode Clerk requirements, LOCAL_HOOK_SECRET length floor, CONTEXTOS_LOG_DESTINATION enum) are enforced here and locked by 8 regression fixtures in `__tests__/unit/config/env.test.ts`.
- `src/framework/manifest-from-zod.ts` — wraps `z.toJSONSchema` with ContextOS's target (`draft-2020-12`) and runtime `type: 'object'` check.
- `src/framework/idempotency.ts` — `IdempotencyKeyBuilder<Input>` contract + `assertIdempotencyKeyBuilder` runtime probe. Read-only tools return `{ kind: 'readonly', key }`; mutating tools return `{ kind: 'mutating', key }` which the registry forwards into the handler's context for ON-CONFLICT dedupe in DB operations.
- `src/framework/policy-wrapper.ts` — `PolicyCheck` abstraction, `PolicyDenyError`, plus `devNullPolicyCheck` always-allow stand-in for S5. S7b replaces it with the real cache-backed `lib/policy.ts::evaluatePolicy` as a single-file swap at `src/index.ts`. `logDevNullPolicyInUse()` writes a WARN at startup so the dev-null path cannot ship to production unnoticed.
- `src/framework/tool-registry.ts` — the enforcement core. `ToolRegistry.register(reg)` validates, synchronously, at registration time:
  1. name shape `^[a-z][a-z0-9_]{2,63}$`, no duplicates
  2. description length ≥ 200 chars (the `MIN_DESCRIPTION_LENGTH` constant)
  3. `inputSchema` is a z.object
  4. `outputSchema` is present (Zod type)
  5. handler arity is exactly 2
  6. idempotencyKey builder returns a well-formed key when probed
  Invalid registrations throw — the server refuses to start. `handleCall` routes every call through input validation → idempotency-key build → pre-phase policy check → handler → output validation → post-phase policy check. Handlers cannot opt out of policy evaluation because they never see an unwrapped call path.
- `src/tools/ping/{schema,handler,manifest}.ts` — the walking-skeleton tool. Read-only, no filesystem/db/network side effects. Returns `{ ok, pong, serverTime, sessionId, idempotencyKey, echo? }`. Description is 666 chars and follows the §24.3 "Call this tool when…/Returns" recipe.
- `src/transports/stdio.ts` — uses the SDK's low-level `Server` + `setRequestHandler` (not the high-level `McpServer.registerTool`) because our custom registry already owns input parsing, output validation, idempotency, and policy. Registers handlers against the SDK-exported `ListToolsRequestSchema` / `CallToolRequestSchema`. Bound to `StdioServerTransport`.
- `src/index.ts` — entrypoint. First import is `./bootstrap/ensure-stderr-logging.js`. Constructs one `ToolRegistry`, registers `pingToolRegistration`, starts the stdio transport with a per-process `sessionId = stdio:<uuid>`. SIGINT/SIGTERM → graceful shutdown.
- `Dockerfile` — four-stage build (deps → build → pnpm deploy → runtime). Base image pinned by digest `node@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34` (Node 22.16.0 bookworm-slim — glibc, required for better-sqlite3/sqlite-vec prebuilt binaries). Runtime stage: non-root `node` user, no build tools, `CONTEXTOS_LOG_DESTINATION=stderr` as defence-in-depth, `CMD ["node", "dist/index.js"]`.
- `.mcp.json` — updated from the stub HTTP URL to a real stdio entry pointing at `apps/mcp-server/dist/index.js` with `env.CONTEXTOS_LOG_DESTINATION=stderr`.
- **Logger change to `@contextos/shared`:** extended `packages/shared/src/logger.ts` to honour `CONTEXTOS_LOG_DESTINATION={unset,stdout,stderr}`. Unknown values throw at module load; `'stderr'` routes pino to fd 2 via `pino.destination({ fd: 2, sync: true })`. Four new tests in `packages/shared/__tests__/unit/logger.test.ts` lock the parse contract.

**Unit tests added (34 new, all green):**

- `__tests__/unit/framework/manifest-from-zod.test.ts` (4) — conversion, `.describe()` passthrough, non-object rejection, JSON-serialisable output.
- `__tests__/unit/framework/tool-registry.test.ts` (13) — 8 negative cases pinning each enforcement rule, 5 happy-path cases including a handler-opt-out proof (deny blocks the handler).
- `__tests__/unit/config/env.test.ts` (8) — four valid fixtures + four invalid fixtures; locks the exact env contract addition D requires.
- `__tests__/unit/tools/ping.test.ts` (8) — manifest contract, roundtrip, echo, oversize rejection, idempotency-key purity.
- `__tests__/unit/transports/stdio-stdout-purity.test.ts` (1) — spawns the real entrypoint via tsx, sends an `initialize` frame, asserts stdout is JSON-RPC-only and stderr is pino-JSON-only. This is the authoritative proof that the stderr-logging contract survives transitive imports.

**Reference updates in the same commit** (amendment B):

- `External api and library reference.md` — new **`@modelcontextprotocol/sdk` (Node.js server)** subsection under Protocols & Transports: exact pin `1.29.0`, Server-vs-McpServer decision, Zod v4 compatibility note (no `zod-to-json-schema`), full stdio-transport stderr contract with links to the three enforcement points.
- `External api and library reference.md` — Pino section amended with the `CONTEXTOS_LOG_DESTINATION` gotcha.

**Deferred to S6+** (not in S5):

- `zod-to-json-schema` — dropped permanently; Zod v4's native helper replaces it.
- `hono`, `@hono/node-server`, `cockatiel`, `@clerk/backend`, `ajv`, `ajv-formats` — added in S16 when the HTTP transport lands. Their pins stay pending in techstack.md until then.
- `testcontainers`, `@testcontainers/postgresql` — added in S17 for integration tests.
- Auth chain (Clerk + solo-bypass + LOCAL_HOOK_SECRET) — S7b only; stdio is a trusted local channel and needs no auth.
- Real `lib/policy.ts::evaluatePolicy` — S7b; the registry's policy injection point is already the right abstraction boundary.

**Files:** `apps/mcp-server/package.json`, `apps/mcp-server/tsconfig.json`, `apps/mcp-server/tsconfig.typecheck.json`, `apps/mcp-server/vitest.config.ts`, `apps/mcp-server/README.md`, `apps/mcp-server/.env.example`, `apps/mcp-server/.dockerignore`, `apps/mcp-server/Dockerfile`, `apps/mcp-server/src/bootstrap/ensure-stderr-logging.ts`, `apps/mcp-server/src/config/env.ts`, `apps/mcp-server/src/framework/{manifest-from-zod,idempotency,policy-wrapper,tool-registry}.ts`, `apps/mcp-server/src/tools/ping/{schema,handler,manifest}.ts`, `apps/mcp-server/src/transports/stdio.ts`, `apps/mcp-server/src/index.ts`, `apps/mcp-server/__tests__/unit/**`, `packages/shared/src/logger.ts`, `packages/shared/__tests__/unit/logger.test.ts`, `.mcp.json`, `External api and library reference.md`.

**Commit:** `feat(mcp-server): scaffold @contextos/mcp-server — stdio transport, tool-registration framework, ping walking skeleton`.

### S6 — §24.3 description assertion helper (shared) + §24.3 spec amendment

The tool-registration framework and `manifest-from-zod` helper landed in S5 as part of the walking-skeleton scope expansion. S6 is therefore narrow but essential: bake the §24.3 "tool descriptions are agent prompts" contract into a single shared helper that every ContextOS tool test — not just mcp-server's — routes through.

**Landed 2026-04-23:**

- **New subpath `@contextos/shared/test-utils`** (see `packages/shared/package.json` `exports`): wired as a dedicated export so production consumers of `@contextos/shared` do not transitively pick up test-only code in their bundle graph.
- `packages/shared/src/test-utils/manifest-assertions.ts` — `assertManifestDescriptionValid(manifest, { folderName? })`. Enforces: name matches `TOOL_NAME_PATTERN` (and folder when supplied, with hyphen → underscore translation), char length in `[200, 800)`, starts with "Call this" (case-insensitive), word count in `[40, 120]`, contains "Returns".
- `packages/shared/src/test-utils/index.ts` — subpath entry re-exports.
- `packages/shared/__tests__/unit/test-utils/manifest-assertions.test.ts` — 11 tests: 3 happy-path + 8 negative (one per rule) so a CI failure names exactly the rule that broke.
- `apps/mcp-server/__tests__/unit/tools/ping.test.ts` — collapsed from 4 ad-hoc assertions to one call into the shared helper. Future tools in `apps/mcp-server/src/tools/<tool>/` and any downstream `@contextos/tools-*` package use the same helper.
- `system-architecture.md` §24.3 amended to "40–80 word soft target, 120-word hard maximum" per Q-02-6. §24.8 safeguard 1 updated to reference the canonical shared helper.

**Decision recorded** (2026-04-23): the helper lives in `@contextos/shared/test-utils`, not `apps/mcp-server/__tests__/helpers/`, because future tool packages shipped outside the mcp-server will need the same assertion without taking a dev dep on the server package.

**Files:** `packages/shared/package.json` (new subpath export), `packages/shared/src/test-utils/{index,manifest-assertions}.ts`, `packages/shared/__tests__/unit/test-utils/manifest-assertions.test.ts`, `apps/mcp-server/__tests__/unit/tools/ping.test.ts`, `system-architecture.md` §24.3 + §24.8.

**Commit:** `feat(shared): assertManifestDescriptionValid in @contextos/shared/test-utils + §24.3 amendment`.

### S7a — Lib layer + frozen `ToolContext` (landed 2026-04-23)

**User directive recap:** before S7b/c land real behaviour, lock the shape of every infrastructure boundary every tool handler will see. "Shapes before guts": a handler written today and a handler written in S15 must reach every subsystem through identical names and identical types. The slice below is that lock.

**What landed:**

- `apps/mcp-server/src/framework/tool-context.ts` — canonical `ToolContext` + `ContextDeps` + `PerCallContext`. Every handler receives the frozen bag; there are no hidden imports, no `globalThis`, no module-level singletons. The `AuthClient`, `PolicyClient`, `FeaturePackStore`, `ContextPackStore`, `RunRecorder`, `SqliteVecClient`, `GraphifyClient`, and `DbClient` interfaces live here — they are the vocabulary shared between the registry and the lib layer.
- `apps/mcp-server/src/lib/{logger,errors,db,auth,policy,feature-pack,context-pack,run-recorder,sqlite-vec,graphify}.ts` — nine typed factories, one file each, each returning a value that satisfies the corresponding `ToolContext` slot. **No module-level singletons are exported.** `createXxxClient(...)` is the only way in.
  - `logger.ts` — `createMcpLogger(moduleName)` wraps `@contextos/shared::createLogger` with an `mcp-server.<moduleName>` namespace.
  - `errors.ts` — `NotImplementedError` (subclass of `@contextos/shared::InternalError`, name `'NotImplementedError'`, carries a `subsystem` tag) + `mcpErrorResult(err)` that translates any `AppError` / unknown throwable into the MCP `{ content, isError: true }` envelope. Used consistently by every lib stub so a CI grep can verify a single error shape across all 8 tools.
  - `db.ts` — `createDbClient(options)` delegates to `@contextos/db::createDb`, returns `{ client, asInternalHandle() }`. `close()` is idempotent. A `_testOverrideInMemory` shorthand is reserved for the stdio-purity subprocess test.
  - `auth.ts` — `createSoloAuthClient()` + `createAnonymousAuthClient()`. Solo returns a stable `SOLO_IDENTITY = { userId: 'user_dev_local', orgId: 'org_dev_local', source: 'solo-bypass' }`. The solo factory emits a WARN on construction so team-mode smoke deployments see the stand-in in every log. Clerk-backed factory lands in S7b behind the same interface.
  - `policy.ts` — `createPolicyClientFromCheck(check)` wraps a `PolicyCheck` callback into a `PolicyClient`; `createDevNullPolicyClient()` is the S7a always-allow stand-in plus its WARN. The previous `framework/policy-wrapper.ts::devNullPolicyCheck` export was deleted; `policy-wrapper.ts` now holds only the shared vocabulary (`PolicyInput`, `PolicyResult`, `PolicyCheck`, `PolicyDenyError`).
  - `feature-pack.ts`, `context-pack.ts`, `run-recorder.ts`, `sqlite-vec.ts`, `graphify.ts` — factories whose methods throw `NotImplementedError('<subsystem>.<method>')`. The signatures already honour the user-directive answers: `context-pack.write(pack, embedding: Float32Array | null)` (Q3 — the store never computes an embedding; Module 04 does); `run-recorder.record({ runId: string | null, ... })` (Q2 — PreToolUse may fire before a run exists; the nullable invariant lives inside the recorder, not at every call site); `sqlite-vec` exposes a domain API (`searchSimilarPacks`) not a raw query runner; `graphify` exposes `expandContext`, not a filesystem helper.
- `apps/mcp-server/src/framework/tool-registry.ts` — constructor now takes `{ deps: ContextDeps, clock?: () => Date, mintRequestId?: () => string }`. Handlers receive the full frozen `ToolContext = ContextDeps & PerCallContext`. The registry is the **single location in `src/**`** that reads from a `Date` constructor (via the injected clock); every `ctx.now()` flows through it. Policy evaluation goes through `deps.policy.evaluate(...)` pre- and post-handler.
- `apps/mcp-server/src/tools/ping/handler.ts` — updated to consume `ToolContext` and produce `serverTime = ctx.now().toISOString()`.
- `apps/mcp-server/src/index.ts` — builds `ContextDeps` from the nine factories, hands it to `new ToolRegistry({ deps })`, registers `ping`, starts the stdio transport, and shuts down (transport + `dbClient.close()`) on SIGINT/SIGTERM. The boot comment is the map of the slice.

**Tests:**

- `__tests__/unit/framework/tool-registry.test.ts` — 18 cases covering construction contract, register-time enforcement, pre/post policy, invalid input, unknown tool, clock injection (`ctx.now()`), and stable `requestId`.
- `__tests__/unit/tools/_no-raw-date.test.ts` — **clock-discipline guard.** Walks `src/tools/**` and fails CI if any file contains a literal `new Date(` substring. The only legitimate `Date` constructor call in `src/**` is the registry's own injected clock.
- `__tests__/unit/tools/ping.test.ts` — migrated to the new `ToolRegistry({ deps })` shape via the shared `makeFakeDeps` helper.
- `__tests__/unit/transports/stdio-stdout-purity.test.ts` — spawns the real `src/index.ts` under `CONTEXTOS_SQLITE_PATH=:memory:` so S7a's newly-wired `createDbClient` does not touch the user's `~/.contextos/data.db`.
- `__tests__/integration/lib/*.test.ts` — one file per factory (`db`, `auth`, `policy`, `feature-pack`, `context-pack`, `run-recorder`, `sqlite-vec`, `graphify`, `logger`, `errors`). 45 tests. Each pins construction contract + stub behaviour so the S7b/c replacements can swap the body without touching signatures.
- `__tests__/helpers/fake-deps.ts` — `makeFakeDeps(overrides?)` for the unit suite.
- `vitest.integration.config.ts` + `pnpm test:integration` script.

**Biome:** `biome.json` now enables `suspicious/noImportCycles: 'error'` on `apps/mcp-server/src/lib/**` so the factory tree stays acyclic as it grows.

**Gate:** `pnpm install --frozen-lockfile` (clean), `check:migration-lock` (ok, 2 blocks), `pnpm lint` (0 errors), `pnpm typecheck` (all 3 packages), `pnpm --filter @contextos/mcp-server test:unit` (39/39), `pnpm --filter @contextos/mcp-server test:integration` (45/45), repo-wide `pnpm test:unit` (full turbo).

**Commit:** `feat(mcp-server): S7a — freeze ToolContext + lib factories + clock-discipline guard`.

**Deferred to later slices (per user directive):**

- S7b lands the real `lib/auth.ts` (Clerk + local-hook-secret chain) and `lib/policy.ts` (cache-first evaluator, cockatiel breaker, async idempotent `policy_decisions` inserts). Swap is a single line in `src/index.ts`.
- S7c lands the real bodies of `lib/feature-pack.ts`, `lib/context-pack.ts`, `lib/run-recorder.ts`, `lib/sqlite-vec.ts`, `lib/graphify.ts`. Each swap is a function-body change only — file tree, interfaces, and wiring are frozen.
- `apps/mcp-server/src/lib/env.ts` — **not needed.** The env schema already lives at `apps/mcp-server/src/config/env.ts` (landed S6); moving it is unnecessary.

### S7b — Lib: auth + policy (security-critical, CODEOWNERS-friendly split)

`apps/mcp-server/src/lib/auth.ts` — Hono middleware that applies (per Q-02-1, in order): (1) solo-bypass when `CLERK_SECRET_KEY === 'sk_test_replace_me'` → `c.set('identity', { mode: 'solo-bypass', orgId: 'org_dev_local', userId: 'user_dev_local' })`; (2) `X-Local-Hook-Secret` header → look up the secret in env / storage, map to orgId; (3) Clerk JWT via `@clerk/backend` `authenticateRequest()` with tenant's JWKS endpoint. First match wins. No match → `c.json({ ok: false, error: 'unauthorized' }, 401)`. Unit tests: one fixture per branch plus the "none match" fallback.

`apps/mcp-server/src/lib/policy.ts` — cache-first evaluator. 60-second in-process LRU keyed by `projectId`. Rule match logic exactly as in spec §4. Wrapped by `circuitBreaker(handleAll, { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(5) })` from cockatiel. On breaker open / throw / timeout → `{ permissionDecision: 'allow', reason: 'policy_check_unavailable', matchedRuleId: null }`. Writes every decision (including fail-open) to `policy_decisions` via `setImmediate` + `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` — per Q-02-2. Async write failure logs at **WARN** with `{ sessionId, toolName, eventType, matchedRuleId, error }` context. Unit tests cover: first-match-wins priority ordering, glob matching, breaker-open fail-open, async-write idempotency, async-write failure logging.

**Files:** `apps/mcp-server/src/lib/auth.ts`, `apps/mcp-server/src/lib/policy.ts`, unit tests.

**Commit:** `feat(mcp-server): lib auth (Clerk + solo bypass + local-hook-secret) + policy engine (fail-open, async idempotent writes)`.

### S7c — Lib: domain services

`apps/mcp-server/src/lib/feature-pack.ts` — filesystem-first loader for `docs/feature-packs/<slug>/{spec,implementation,techstack}.md`. Computes checksum = sha256 of the three files concatenated in that fixed order (per Q-02-4). On read, compares against the DB row in `feature_packs`; mismatch drops the in-process cache entry and updates the row. Inheritance resolver: scalar override + array concat, root → leaf, cycle detection (per §16 pattern 9).

`apps/mcp-server/src/lib/context-pack.ts` — writes `docs/context-packs/YYYY-MM-DD-<slug>.md` AND inserts a `context_packs` row. `content_excerpt` = first 500 Unicode **code points** of `content` with trailing whitespace trimmed, computed via `Array.from(content).slice(0, 500).join('')` (code-point-safe; multi-byte chars preserved). Unit test asserts multi-byte-safe truncation with an emoji at position 499.

`apps/mcp-server/src/lib/run-recorder.ts` — writes `runs` and `run_events` via the outbox pattern described in §16 pattern 3: insert into `pending_jobs` first, return; a background worker drains. In Module 02 the worker is in-process and polled on a 500 ms interval (§4.1).

`apps/mcp-server/src/lib/graphify.ts` — reads `~/.contextos/graphify/<slug>/graph.json`. If absent → returns `{ present: false, notice: 'graphify_index_missing', howToFix: 'run `graphify scan` at repo root' }`. If present → parses, caches, returns `{ present: true, nodes, edges, communities }`.

`apps/mcp-server/src/lib/sqlite-vec-client.ts` — thin helper on top of `@contextos/db`'s SQLite client. `insertEmbedding(contextPackId, vector)` and `knn(vector, k)` functions. Unit test uses an in-memory SQLite with the extension loaded.

**Files:** the five `src/lib/*.ts` files + matching unit tests under `__tests__/unit/lib/`.

**Commit:** `feat(mcp-server): lib domain — feature-pack, context-pack, run-recorder, graphify, sqlite-vec-client`.

### S8 — Tool `get_run_id`

`apps/mcp-server/src/tools/get-run-id/{handler,schema,manifest}.ts` + unit tests + `manifest.test.ts`. Handler: reads the most recent `runs` row where `status = 'in_progress'` and `session_id` matches the caller's `sessionId` (from MCP request context). If none exists, creates one with `idempotency_key = run:{projectId}:{sessionId}:{uuid}` and returns `{ runId, startedAt }`. Description verbatim from §24.4.

**Commit:** `feat(mcp-server): tool get_run_id`.

### S9 — Tool `get_feature_pack`

Handler delegates to `lib/feature-pack.ts`. Returns `{ pack, subPack?, inherited: [] }` per §24.4. `filePath` is optional — when supplied, resolves the deepest pack whose `sourceFiles` matches (inheritance-aware).

**Commit:** `feat(mcp-server): tool get_feature_pack`.

### S10 — Tool `save_context_pack`

Handler delegates to `lib/context-pack.ts`. Idempotent per `runId` (existence check before insert; duplicate returns the existing `contextPackId` per §24.4). Marks the run as `completed`. Writes `content_excerpt` at insert time.

**Commit:** `feat(mcp-server): tool save_context_pack`.

### S11 — Tool `search_packs_nl` with LIKE fallback

Two paths:

- **Semantic path (solo):** encode `query` via `@contextos/shared` `logger` (Module 05 will swap in a real embedding call; Module 02 reuses the embedding stored on `context_packs` if present). Query `context_packs_vec` via `sqlite-vec-client.knn(...)`.
- **Semantic path (team):** pgvector `ORDER BY summary_embedding <=> :query_vec LIMIT :k`.
- **LIKE fallback:** when no candidate row has a `summary_embedding`, query `context_packs` with `LOWER(title) LIKE :needle OR LOWER(content_excerpt) LIKE :needle` ordered by `created_at DESC`, LIMIT `limit`. Response includes `notice: 'no_embeddings_yet'` and `howToFix: 'Module 05 (NL Assembly) will populate summary_embedding on save.'`.

Manifest description includes the fallback behaviour per directive Step 3.

**Commit:** `feat(mcp-server): tool search_packs_nl with LIKE fallback`.

### S12 — Tool `query_run_history`

Chronological list of runs with optional `status` filter. Default limit 10. Returns `{ runs: [{ runId, startedAt, endedAt, status, title, issueRef, prRef }] }`.

**Commit:** `feat(mcp-server): tool query_run_history`.

### S13 — Tool `record_decision`

Inserts a row into a new `decisions` table (introduced in this commit's migration patch — add it to S3's migration if caught in review, else a tiny 0002 migration. Decision: include in `0001` via an amendment to S3's commit before it's merged; if S3 is already pushed, add a `0002_decisions.sql` in this commit). Idempotency key: `dec:{runId}:{hash(description)}` — prevents duplicate records on retries. Returns `{ decisionId }`.

**Pre-flight check during implementation:** if S3 is still unmerged when S13 lands, fold `decisions` into S3's migration. Otherwise create `0002_decisions.sql` in this commit.

**Commit:** `feat(mcp-server): tool record_decision`.

### S14 — Tool `check_policy`

Delegates to `lib/policy.ts`. Returns `{ permissionDecision, reason, policyId? }` synchronously. Fires the policy_decisions insert asynchronously via `setImmediate`. Latency target < 10 ms — unit test with a timing assertion.

**Commit:** `feat(mcp-server): tool check_policy (fail-open, async policy_decisions write)`.

### S15 — Tool `query_codebase_graph` with graphify-missing fallback

Handler delegates to `lib/graphify.ts`. If `graph.json` missing → return `{ ok: true, nodes: [], edges: [], notice: 'graphify_index_missing', howToFix: 'run `graphify scan` at repo root' }`. Else → returns the matching subgraph for the `query` symbol (exact-name first, then substring, then neighbourhood by 1 hop).

**Commit:** `feat(mcp-server): tool query_codebase_graph with graphify-missing fallback`.

### S16 — Transports + server entrypoint

`apps/mcp-server/src/transports/stdio.ts` — JSON-RPC framed IO, Content-Length header, uses `@modelcontextprotocol/sdk/server/stdio.js`. **Pino logger redirected to `process.stderr`** so stdout carries only protocol frames. Unit test asserts 100-message round-trip with no stray stdout bytes.

`apps/mcp-server/src/transports/http.ts` — Hono app with `POST /mcp` (accepts JSON-RPC single or batch; responds `application/json` for unary or `text/event-stream` per MCP Streamable HTTP spec), `GET /mcp` (server→client stream leg), `GET /healthz`. Auth middleware from `lib/auth.ts` applied to `/mcp` only. Served via `@hono/node-server` `serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })` — loopback-only in solo mode.

`apps/mcp-server/src/index.ts` — starts both transports concurrently. Parses `--transport stdio|http|both` flag (default `both`). Graceful shutdown on SIGINT/SIGTERM: drains in-flight requests, flushes pending policy_decisions writes, closes the DB.

**Commit:** `feat(mcp-server): stdio + Streamable HTTP transports + server entrypoint`.

### S17 — Integration tests

`apps/mcp-server/__tests__/integration/stdio-roundtrip.test.ts` — in-process Duplex pair + `@modelcontextprotocol/sdk` `Client`. Sends `initialize` + `tools/list` + `tools/call` for each of the 8 tools. Asserts stdout purity (no non-JSON-RPC bytes in the Duplex buffer).

`apps/mcp-server/__tests__/integration/http-roundtrip.test.ts` — spawns the real Hono server on an ephemeral port; same round-trip assertions via HTTP.

`apps/mcp-server/__tests__/integration/manifest-e2e.test.ts` — per §24.9. Asserts: exactly 8 tools, names match the expected set, list is sorted by name, every `description.length < 800`, every `inputSchema` compiles under Ajv, every tool returns either a valid shape or a documented `{ ok: false, error }` for a minimal valid input. **Exercises both fallbacks** — `search_packs_nl` with zero embeddings asserts `notice: 'no_embeddings_yet'`; `query_codebase_graph` without a graph file asserts `notice: 'graphify_index_missing'`.

`apps/mcp-server/__tests__/integration/policy-decisions-idempotency.test.ts` — uses `@testcontainers/postgresql` to boot Postgres 16 with pgvector. Runs migrations, inserts a policy + rule, calls `check_policy` twice with the same input. Asserts one row in `policy_decisions` (the second write hit `ON CONFLICT DO NOTHING`).

**Commit:** `test(mcp-server): integration — stdio, http, manifest-e2e, policy-decisions idempotency`.

### S18 — CI extension

Extend `.github/workflows/ci.yml`:

- `verify` job: add `apps/mcp-server` to the matrix implicitly via the root `pnpm lint / typecheck / test:unit`. Add an explicit `pnpm --filter @contextos/db run check:migration-lock` step BEFORE lint.
- `integration` job: on the same Postgres + Redis service containers already running, add `pnpm --filter @contextos/mcp-server test:integration`. Docker socket is available on `ubuntu-latest` by default, so `testcontainers` works without further config.

**Commit:** `ci(mcp-server): extend workflow for apps/mcp-server + migration lock check`.

### S19 — Verification gate

Run locally:

```bash
pnpm install --frozen-lockfile
pnpm --filter @contextos/db run check:migration-lock
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm --filter @contextos/mcp-server test:integration   # requires Docker running
```

All six must pass. Coverage report confirms `apps/mcp-server ≥ 80% line coverage`. Any failure → fix commit on this branch, never a workaround.

### S20 — `.mcp.json` update + DEVELOPMENT.md update + Module 02 Context Pack

Update `.mcp.json` per Q-02-7 — point at workspace-relative `apps/mcp-server/dist/index.js`, update the inline `_comment` to note the CLI install helper is deferred to Module 07+.

Extend `docs/DEVELOPMENT.md` with an **MCP server** section: how to run `pnpm --filter @contextos/mcp-server dev`, how to point a Claude Code / Windsurf instance at the running server, how to hit `GET /healthz`, troubleshooting notes for sqlite-vec load failure.

Write `docs/context-packs/2026-04-22-module-02-mcp-server.md` from `docs/context-packs/template.md`. Must document: the 8 tools shipped, the two partial-capability fallbacks (with reactivation plan for Modules 05/17), every decision recorded during the module, every file touched, test results, and the pending Clerk live-validation flag.

**Commit:** `docs(02-mcp-server): module-02 context pack + .mcp.json + DEVELOPMENT.md`.

### S21 — Push to remote + merge

```bash
git push -u origin feat/02-mcp-server
```

Open PR. On review approval, squash-merge to `main`. After merge, user reloads their IDE; `contextos__*` tools become callable for the first time (§3.5, §24.2). Module 03+ uses them from the next session onward.

## Rollback strategy

If any step introduces a regression discovered after its commit, fix forward via an additional commit on this branch. Do not force-push `feat/02-mcp-server` during Module 02 — the history is part of the Context Pack.

## Logging discipline during Module 02

- After each file write: append a `- [HH:mm] <verb> <object> — <outcome>` line to `context_memory/current-session.md` Log section.
- After each design decision: append to `context_memory/decisions-log.md` with timestamp, decision, rationale, alternatives.
- Open questions and blockers go to `context_memory/open-questions.md` / `context_memory/blockers.md`.
- The manual discipline above is **still** the source of truth during Module 02. Once the server is merged and reloaded, the `contextos__*` tools take over and the manual discipline becomes the fallback path.
