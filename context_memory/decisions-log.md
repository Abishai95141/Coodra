# Decisions Log

Append-only. One entry per design/implementation decision. See `essentialsforclaude/03-context-memory.md` §3.2 + `05-agent-trigger-contract.md` §5.4.

Format:

```
## YYYY-MM-DD HH:mm — <short title>
**Decision:** <one-sentence what>
**Rationale:** <why this over alternatives>
**Alternatives considered:** <option A | option B>
**Reference:** <pointer into architecture / reference / ADR>
```

---

## 2026-04-22 14:13 — Bootstrap caveat: ContextOS MCP tools are not callable during Module 01

**Decision:** Use `context_memory/` by hand (manual writes to `current-session.md`, `decisions-log.md`, etc.) until Module 02 ships the MCP server and `.mcp.json` points to a live endpoint.
**Rationale:** The `contextos__*` tools described in `essentialsforclaude/05-agent-trigger-contract.md` require a running MCP server. That server is the Module-02 deliverable. Attempting to call those tools now would fail; faking a shape would violate the no-shallow-proxy rule (`01-development-discipline.md` §1.1). User explicitly instructed this in bootstrap request Step 2.
**Alternatives considered:** Skip context memory during Module 01 | stub the MCP calls to local file writes now (rejected — hides the missing dependency).
**Reference:** user Step 2 directive; `essentialsforclaude/03-context-memory.md` §3.2.

## 2026-04-22 14:27 — Module implementation order starts at Module 01 (Foundation) with explicit non-goals

**Decision:** Module 01 ships only the scaffold + `packages/shared` + `packages/db` + docker-compose + CI + docs + Context Pack. No `apps/*`, no `services/*`, no integration tests, no Clerk wiring beyond the solo-bypass fixture.
**Rationale:** `essentialsforclaude/08-implementation-order.md` §8.1 enforces linear build order. Creating empty `apps/` or `services/` now would be a shallow proxy violating `01-development-discipline.md` §1.1.
**Alternatives considered:** Front-load empty apps scaffolding so Module 02 starts with cd-into-apps/mcp-server (rejected — stubs).
**Reference:** `docs/feature-packs/01-foundation/spec.md` §3.

## 2026-04-22 14:27 — Adopt Next.js 16.2.4 + React 19.2.5 (overrides architecture's "Next.js 15")

**Decision:** Pin `next@^16.2.4` and `react@^19.2.5` / `react-dom@^19.2.5` when Module 04 lands. Architecture §2 and the `External api and library reference.md` Next.js section are updated in the **same commit** that introduces `apps/web/package.json` in Module 04 (amendment B).
**Rationale:** This is a fresh build with zero migration cost; pinning at Next.js 15 while npm latest is 16.2.4 would create upgrade debt and force a future breaking-change window.
**Alternatives considered:** Pin at Next.js 15 as the architecture currently dictates (rejected — upgrade debt). Defer decision to Module 04 (rejected — locks the techstack note in Module 01 now).
**Reference:** user Q2 answer; bootstrap-plan §4; `docs/feature-packs/01-foundation/techstack.md` forward-looking pins.

## 2026-04-22 14:27 — Adopt Pino 10.3.1

**Decision:** Install `pino@^10.3.1` (and `pino-pretty@^13.1.3` dev) in `packages/shared`. Update `External api and library reference.md` Pino section in the same commit (from 9.9.5 to 10.3.1 with ESM-only note).
**Rationale:** Pino 10 is ESM-only, matching our `tsconfig.base.json` `module: nodenext` setup. Fresh build, no migration cost from 9.x.
**Alternatives considered:** Pin Pino 9.9.5 as the reference currently says (rejected — fresh build, no reason to lag).
**Reference:** user Q3 answer.

## 2026-04-22 14:27 — Adopt @hono/node-server 2.0.0

**Decision:** Pin `@hono/node-server@^2.0.0` for Module 03. Update reference in the Module-03 commit.
**Rationale:** Fresh build; 2.x changes the `serve()` return shape and writing code against 1.x-only patterns now would require rewriting at Module 03 install time.
**Alternatives considered:** Pin 1.19.3 (rejected — upgrade debt).
**Reference:** user Q4 answer.

## 2026-04-22 14:27 — Adopt TypeScript 6.0.3

**Decision:** Pin `typescript@^6.0.3` at the root `package.json`. Update the Tooling section of `External api and library reference.md` in the same commit with a new pin (no prior pin existed).
**Rationale:** Fresh project. TS 6 is the current stable major; no prior TS 5 code to migrate.
**Alternatives considered:** Pin TS ~5.9 for library-compat caution (rejected — major ecosystem packages already ship TS 6-compatible types).
**Reference:** user Q5 answer.

## 2026-04-22 14:27 — Python services pin `requires-python = ">=3.12,<3.14"`

**Decision:** When `services/nl-assembly/pyproject.toml` and `services/semantic-diff/pyproject.toml` are added in Modules 05/06, their `requires-python` will be `>=3.12,<3.14`. `uv` will provision a 3.12 venv per service. System Python stays 3.14.4.
**Rationale:** `sentence-transformers` and `tree-sitter` bindings lag on 3.14 wheels; forcing 3.14 would compile from source and brittle the CI.
**Alternatives considered:** Use system 3.14 and compile from source (rejected — CI brittleness) | pin at exactly 3.12 (rejected — over-constrained).
**Reference:** user Q6 answer.

## 2026-04-22 14:27 — Hand-authored dual schemas + CI parity test

**Decision:** `packages/db/src/schema/sqlite.ts` and `packages/db/src/schema/postgres.ts` are authored by hand. A Vitest test in `packages/db/__tests__/unit/schema-parity.test.ts` asserts column-name + nullability + type-category parity for every table in the 5-table core and **fails the build** on drift (not a warning).
**Rationale:** Drizzle requires separate dialect modules (`sqlite-core` vs `pg-core`); a code-generator from a shared Zod source is over-engineered for Module 01. A hard CI assertion is the cheapest path to preventing silent drift.
**Alternatives considered:** Generate both schemas from a shared Zod source (rejected — premature abstraction) | no parity test, trust review (rejected — drift inevitable).
**Reference:** user Q7 answer; `docs/feature-packs/01-foundation/spec.md` §2 #5.

## 2026-04-22 14:27 — Defer Clerk project provisioning to Module 04

**Decision:** Module 01 uses the `sk_test_replace_me` solo-bypass fixture described in `system-architecture.md` §19. No real Clerk project is created until Module 04 begins.
**Rationale:** Module 01 runs in solo mode only; Clerk is unreachable until the web app needs it.
**Alternatives considered:** Provision Clerk now (rejected — premature external account registration) .
**Reference:** user Q8 answer; `02-agent-human-boundary.md` §2.2 "never fake a user action".

## 2026-04-22 14:27 — Schema ships 5 tables in Module 01; each later module owns its own tables

**Decision:** `packages/db/src/schema/*.ts` contains exactly `projects`, `runs`, `run_events`, `context_packs`, `pending_jobs` in Module 01. `policy_rules`, `policy_decisions`, `feature_packs`, `integrations`, `integration_tokens`, `integration_events`, `knowledge_edges` land in the module that first needs them via new numbered migrations.
**Rationale:** Each module takes ownership of its own surface. Front-loading the full schema would create tables nothing reads in Module 01, violating "every feature is real or absent" (§1.1).
**Alternatives considered:** Front-load full schema (rejected — dead tables are stubs).
**Reference:** user Q9 answer; `docs/feature-packs/01-foundation/spec.md` §4.

## 2026-04-22 14:27 — `.mcp.json` stub with explanatory `_comment`

**Decision:** Ship a valid JSON `.mcp.json` pointing to `http://127.0.0.1:3100/mcp` with a `_comment` field naming Module 02 as the delivery point.
**Rationale:** Claude Code / Cursor / Windsurf auto-load `.mcp.json`; its absence would surface as a different UX than "MCP server not running yet". A valid-but-failing endpoint is the honest state.
**Alternatives considered:** Omit `.mcp.json` until Module 02 (rejected — less honest about intended endpoint).
**Reference:** user Q10 answer.

## 2026-04-22 14:27 — Defer Docker daemon install to Module 02 start

**Decision:** Module 01 ships `docker-compose.yml` as a spec artifact but does not require Docker to be running. `docker compose config` validates the file shape; live service startup is a Module-02 prerequisite.
**Rationale:** Module 01 has no integration tests and no service that needs Postgres/Redis. Forcing Docker install now blocks progress.
**Alternatives considered:** Install Docker now (rejected — unnecessary) | skip compose file entirely (rejected — spec artifact for Module 02 should land with Foundation).
**Reference:** user Q1 answer.

## 2026-04-22 14:33 — MIT LICENSE at repo root

**Decision:** Ship MIT License in the root-metadata commit; `package.json` `"license": "MIT"`.
**Rationale:** User-specified.
**Alternatives considered:** None (user directive).
**Reference:** user plan amendment C.

## 2026-04-22 14:35 — Commit-level invariant: version bumps + doc updates in the same commit

**Decision:** Every commit that bumps a pinned version in any `package.json` must amend `External api and library reference.md` (and `system-architecture.md` where the bump contradicts that doc) in the same commit. Never a follow-up commit.
**Rationale:** Prevents the documented version drifting out of sync with the pinned version even for one commit window. Follow-up commits tend to get forgotten.
**Alternatives considered:** Batch doc updates at end-of-module (rejected — drift window between commits).
**Reference:** user plan amendment B.

## 2026-04-22 20:58 — Module 02 auth chain on HTTP transport: three layers, first match wins (Q-02-1)

**Decision:** MCP server HTTP transport applies auth middleware in this order: (1) solo-bypass when `CLERK_SECRET_KEY === 'sk_test_replace_me'`, (2) `X-Local-Hook-Secret` header equals `LOCAL_HOOK_SECRET` env value, (3) full Clerk JWT via `@clerk/backend` `authenticateRequest()`. First match wins. Stdio transport has no auth (local-only by construction — parent process owns stdin).
**Rationale:** Matches `system-architecture.md` §19's three-mode model. Solo developers never need real Clerk; local adapter scripts authenticate via the shared secret without embedding a user token in a shell script; full JWT covers the real team-mode case. Ordering ensures the cheapest, most common path (solo-bypass) short-circuits.
**Alternatives considered:** Single-mode (Clerk JWT only) with a separate dev endpoint (rejected — two code paths instead of one, and the dev endpoint would itself need auth).
**Reference:** user Q-02-1 answer; `system-architecture.md §19`.

## 2026-04-22 20:58 — Module 02 policy_decisions write cadence: async + idempotent + WARN on failure (Q-02-2)

**Decision:** `check_policy` evaluates synchronously and returns the decision in-line; the `policy_decisions` INSERT fires asynchronously via `setImmediate` using `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`. Async-write failure logs at **WARN** (not INFO) with full decision context — `sessionId`, `toolName`, `eventType`, `matchedRuleId`, `error`. Durable outbox via `pending_jobs` is explicitly deferred; revisit post-Module-03 if DB downtime becomes visible in decision-count drift.
**Rationale:** Meets §24.4's <10 ms latency target for `check_policy` while preserving the §4.3 append-only guarantee via the unique idempotency-key constraint. WARN-level logging on write failure is loud enough to surface in log aggregation without being a live-site alarm (decision is already in the agent's hands by then, and fail-open preserves availability).
**Alternatives considered:** Synchronous write in the request path (rejected — blows the 10 ms budget). Route through `pending_jobs` outbox today (rejected — extra machinery before we've observed any failure mode).
**Reference:** user Q-02-2 answer; `system-architecture.md §16 pattern 3 (Outbox)`, §4.3, §24.4.

## 2026-04-22 20:58 — Module 02 content_excerpt is Unicode code-point safe (Q-02-3)

**Decision:** `context_packs.content_excerpt` is the first **500 Unicode code points** (not bytes, not JS string `.length`) of `content` with trailing whitespace trimmed. Implemented via `Array.from(content).slice(0, 500).join('')` which iterates code points and preserves multi-byte characters. A unit test inserts an emoji or CJK character at position 499 and asserts lossless truncation.
**Rationale:** `String#slice` in JS operates on UTF-16 code units and will split surrogate pairs mid-character on emoji or supplementary-plane CJK, producing a broken string. The column is NOT NULL and used by `search_packs_nl` LIKE fallback — corrupted excerpts would poison search results. The code-point approach is O(n) but n ≤ 500 so cost is negligible.
**Alternatives considered:** `content.slice(0, 500)` (rejected — surrogate-pair unsafe). `Buffer.byteLength` byte-bounded truncation (rejected — bytes != characters; variable-width-UTF-8 makes this even worse than UTF-16 code units).
**Reference:** user Q-02-3 answer.

## 2026-04-22 20:58 — Module 02 Feature Pack storage: filesystem source of truth + DB checksum invalidation (Q-02-4)

**Decision:** Feature Packs live at `docs/feature-packs/<slug>/{spec,implementation,techstack}.md` on disk (source of truth). A `feature_packs` DB row carries metadata only: `id`, `slug`, `parent_slug`, `is_active`, `checksum`, `updated_at`. Checksum = sha256 of `spec.md + implementation.md + techstack.md` concatenated in that fixed order. On read, compare against the DB row; mismatch drops the 60-second in-process cache entry and updates the row.
**Rationale:** Files-first respects the editorial workflow (tech leads edit markdown in PRs) while the DB row enables activation/inheritance queries without fanning reads across the filesystem. Fixed concatenation order makes the checksum reproducible across machines. 60 s cache TTL matches §5's AP, cache-first tolerance for feature-pack retrieval.
**Alternatives considered:** DB-first with markdown rendered from a `content` column (rejected — breaks the PR-review workflow). No cache (rejected — every tool call re-reads three files). Cache with time-only invalidation (rejected — allows a tech lead's push to be ignored for up to 60s).
**Reference:** user Q-02-4 answer; `system-architecture.md §5` Feature Pack Retrieval → AP Cache-First, §16 pattern 9.

## 2026-04-22 20:58 — Module 02 Clerk middleware ships wired but unvalidated against live Clerk (Q-02-5)

**Decision:** Clerk middleware is coded against env-var reads and commits in S7b. All unit/integration tests pass without real Clerk keys (solo-bypass + mocked verify). The Module 02 Context Pack and `context_memory/pending-user-actions.md` explicitly flag "Team-mode auth wired but untested against live Clerk until user provides keys; first live validation during Module 04 or when team mode is first flipped for real". Module 02 acceptance checklist marks team-mode auth as 'wired, pending live validation' — not 'complete'.
**Rationale:** Waiting on real Clerk keys before merging Module 02 would gate 9 other slices on an external account registration. The solo-bypass path is complete and testable today. Honest flagging in the Context Pack prevents a future session assuming Clerk is fully validated.
**Alternatives considered:** Halt at the Clerk commit until keys are pasted (rejected by user Q-02-5). Ship without Clerk middleware at all and add in Module 04 (rejected — leaves team-mode HTTP transport unauthenticated; risks a merged-without-auth state that would be hard to spot).
**Reference:** user Q-02-5 answer; `essentialsforclaude/02-agent-human-boundary.md §2.2` "never fake a user action".

## 2026-04-22 20:58 — Module 02 manifest word budget: 40–80 soft target, 120 hard max (Q-02-6)

**Decision:** Per-tool `manifest.test.ts` asserts description word count is ≥ 40 and ≤ 120. `system-architecture.md §24.3` is amended in the same commit as the manifest test (S6) from "40–80 words" to "40–80 word soft target, 120-word hard maximum". The eight verbatim descriptions from `§24.4` are not tightened — architecture should describe what we actually test.
**Rationale:** §24.4's description for `check_policy` is 93 words and for `save_context_pack` is 85; tightening them would lose load-bearing detail (the "do NOT proceed on deny" clause, the "only handoff mechanism to next session" clause). Widening the test bound and documenting the widening is the honest reconciliation. 120 words at ~5 chars/word = ~600 chars, still well under the 800-char hard cap in §24.9.
**Alternatives considered:** Keep 80-word max and rewrite §24.4 descriptions to fit (rejected — lose load-bearing detail). Keep 80-word max and exempt the two offending tools in code comments (rejected — allowlist-based discipline drifts).
**Reference:** user Q-02-6 answer; `system-architecture.md §24.3`, §24.4.

## 2026-04-22 20:58 — Module 02 `.mcp.json` target: workspace-relative dist, no CLI install helper (Q-02-7)

**Decision:** `.mcp.json` stub updated in S20 from `~/.contextos/bin/mcp-server.js` (the eventual install location) to the workspace-relative `apps/mcp-server/dist/index.js`. The inline `_comment` field notes the CLI install helper (which would symlink into `~/.contextos/bin/`) is deferred to Module 07 or a dedicated distribution module.
**Rationale:** Dev ergonomics — the server becomes immediately runnable after a `pnpm build` without a separate install step. Contributors don't need to know about `~/.contextos/bin/` to try ContextOS. When distribution matters (Module 07, VS Code extension packaging, external contributors), the install helper lands and the stub updates then.
**Alternatives considered:** Ship the CLI install helper in Module 02 (rejected — out of scope for an MCP-server module; belongs with distribution work). Keep the stub pointing at `~/.contextos/bin/` and expect the contributor to symlink (rejected — poor first-run UX).
**Reference:** user Q-02-7 answer; `system-architecture.md §3.5`.

## 2026-04-22 20:58 — Module 02 split S7 into S7a/S7b/S7c along trust boundaries (Addition A)

**Decision:** The single S7 "Lib layer" slice in the original plan is split into three separately-committed slices: S7a (infra — `db.ts`, `env.ts`, `logger.ts`, `errors.ts`, `manifest-from-zod.ts`), S7b (security-critical — `auth.ts`, `policy.ts`), S7c (domain — `feature-pack.ts`, `context-pack.ts`, `run-recorder.ts`, `graphify.ts`, `sqlite-vec-client.ts`). Total slice count goes from 21 to 23.
**Rationale:** S7b touches the auth surface and the fail-open policy engine; isolating it in its own commit makes CODEOWNERS review tractable and the blast radius of a security regression bounded to one commit to revert. The infra / domain split keeps each slice small enough to review in one sitting.
**Alternatives considered:** Keep S7 as one commit (rejected — ~2000-line diff spanning infra/security/domain). Split by file rather than by trust boundary (rejected — arbitrary, doesn't help review).
**Reference:** user plan-approval addition A.

## 2026-04-22 20:58 — Module 02 hand-edited migrations are sha256-locked with CI enforcement (Addition B)

**Decision:** Every migration file that contains SQL Drizzle-Kit did not emit (the sqlite-vec `CREATE VIRTUAL TABLE`, the pgvector `CREATE INDEX ... USING hnsw`, and any future similar block) wraps that block in `-- @preserve-begin hand-written` / `-- @preserve-end` comments. A committed `packages/db/migrations.lock.json` records the sha256 of each block. `packages/db/scripts/check-migration-lock.mjs` extracts every preserve-block, recomputes sha256, diffs against the lock file, and exits non-zero on mismatch. Wired as the first step of the CI `verify` job (before lint). A pre-commit-reminder paragraph in `docs/DEVELOPMENT.md` tells contributors what to do if `drizzle-kit generate` regenerates a migration and wipes the hand-written block.
**Rationale:** `drizzle-kit generate` has no awareness of the custom vec0 and HNSW DDL and will happily rewrite a migration file, losing the hand-written bits. Without enforcement, this would only surface at runtime when `migrate` runs a migration without the virtual table or index. sha256-lock + CI grep catches it at PR time.
**Alternatives considered:** Trust review (rejected — drift inevitable). Put the hand-written SQL in a separate migration file (rejected — breaks Drizzle's sequential migration numbering and introduces an out-of-order migration problem).
**Reference:** user plan-approval addition B.

## 2026-04-22 20:58 — Module 02 env schema is strict on Clerk keys (Addition C)

**Decision:** `apps/mcp-server/src/lib/env.ts` `superRefine`s the base env schema so `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` are optional in solo mode OR when `CLERK_SECRET_KEY === 'sk_test_replace_me'`, but required in team mode with the placeholder disallowed. Secret must match `/^sk_(test|live)_/`, publishable `/^pk_(test|live)_/`. Parse failure is a startup `ValidationError` from `@contextos/shared` with a specific pointer to the wrong env var.
**Rationale:** Team mode with the placeholder secret would silently run as solo-bypass in production — exactly the "team-mode without auth" failure mode that would be hardest to detect (it works for the developer who set it up, fails silently for everyone else). Startup-time fast-fail is the correct boundary.
**Alternatives considered:** Allow the placeholder in all modes and rely on CI/staging to catch it (rejected — "works on my machine, fails in prod" is the anti-pattern we're preventing). Discriminated union in the main env schema (rejected — `superRefine` is cleaner because the discriminant is a string value, not a type).
**Reference:** user plan-approval addition C; `system-architecture.md §19`.

## 2026-04-22 20:58 — Module 02 env-shape regression test with four fixtures (Addition D)

**Decision:** `apps/mcp-server/__tests__/unit/lib/env.test.ts` locks the env contract with four fixtures: (1) **valid-solo** — `CONTEXTOS_MODE=solo`, no Clerk keys, all defaults populate; (2) **valid-team** — `CONTEXTOS_MODE=team`, real `sk_test_...` + `pk_test_...`, parse succeeds; (3) **missing-clerk-in-team** — `CONTEXTOS_MODE=team`, no Clerk keys, MUST throw `ValidationError` with the Clerk-specific error message; (4) **malformed-port** — `MCP_SERVER_PORT=abc`, MUST throw `ValidationError`.
**Rationale:** Env parsing is the gate on every startup. Without fixture coverage, a refactor to the schema could silently accept invalid envs or reject valid ones. Four fixtures is the minimum to pin the two axes (mode × Clerk presence) + one "obviously wrong" control.
**Alternatives considered:** Exhaustive combinatorial fixtures (rejected — four is enough to pin each path). No regression test (rejected — addition D is explicitly required).
**Reference:** user plan-approval addition D.

## 2026-04-22 22:08 — sqlite-vec load failure is strict in test, fail-open in production (S4 refinement)

**Decision:** `packages/db/src/client.ts::loadSqliteVecOrFail` wraps `sqliteVec.load(db)` in a try/catch. When `process.env.NODE_ENV === 'test'` **or** `process.env.CONTEXTOS_REQUIRE_VEC === '1'`, a load failure throws `InternalError('sqlite_vec_unavailable')` with the underlying cause, logs an `error`-level structured line (`{ event: 'sqlite_vec_unavailable', loadablePath, platform, arch, err }`), and refuses the SQLite handle. Otherwise, the failure logs a `warn`-level line with the same shape and `createSqliteDb` returns a working handle that still serves all non-vector operations. Env vars are re-read on every call so tests can flip them at runtime. Covered by three integration tests in `packages/db/__tests__/integration/sqlite-vec.test.ts` (one per branch).

**Rationale:** The user's S4 approval was explicit — "Don't let dev/test silently degrade". CI and local test runs must never produce false-green results from a missing embedding-index, because the LIKE-over-`content_excerpt` fallback is a semantic degradation that would mask real regressions. Production, by contrast, must stay available: a new binary platform without a prebuilt sqlite-vec should still let the MCP server serve contextual reads with reduced precision, per the §7 fail-open discipline.

**Alternatives considered:** Always throw (rejected — would take down production on any platform sqlite-vec doesn't yet ship binaries for). Always warn (rejected — hides CI regressions). Toggle via a schema env field only (rejected — `NODE_ENV=test` is Vitest's own convention; coupling to it is more predictable than requiring every test to set a ContextOS-specific flag).

**Reference:** user S4 approval, third refinement; `system-architecture.md §7`; `packages/db/src/client.ts`; `External api and library reference.md` → sqlite-vec → Strict-vs-WARN contract.

## 2026-04-22 22:10 — pgvector HNSW index parameters are m=16, ef_construction=64

**Decision:** The hand-written preserve-block in `packages/db/drizzle/postgres/0001_clean_rafael_vega.sql` creates `context_packs_embedding_hnsw_idx ON context_packs USING hnsw (summary_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`. `m` = number of bidirectional HNSW links per node (controls graph connectivity and storage). `ef_construction` = size of the dynamic candidate list during index build (controls build-time quality). `ef_search` stays at the pgvector session default (40) and is tunable at query time via `SET LOCAL hnsw.ef_search = N`. The `postgres-migrate.test.ts` integration test asserts both parameters appear in `pg_indexes.indexdef`.

**Rationale:** `m=16, ef_construction=64` are pgvector 0.8.x's own defaults, chosen by its authors for datasets up to ~1M rows with ~95% recall at `ef_search=40`. Module 02's expected working set (every Context Pack ever saved) is well inside that envelope. Explicitly writing the defaults (rather than omitting them and relying on the version default) locks the DDL against pgvector default changes and makes the decision grep-able in the migration file itself.

**Alternatives considered:** `m=32, ef_construction=128` (rejected — doubles index size and build time for a recall improvement we cannot currently measure; revisit in Module 05 if recall benchmarks motivate it). `m=8, ef_construction=32` (rejected — pgvector README warns that below the default, recall degrades noticeably beyond a few hundred thousand rows). Omit the WITH clause and rely on pgvector defaults (rejected — silent version coupling).

**Reference:** user S4 approval, fourth refinement ("Record HNSW param choice via record_decision"); pgvector 0.8.x README → HNSW tuning; `packages/db/drizzle/postgres/0001_clean_rafael_vega.sql` preserve-block; `packages/db/__tests__/integration/postgres-migrate.test.ts` HNSW-index-exists assertion.

## 2026-04-23 16:20 — Module 02 S5 is stdio-only; HTTP transport deferred to S16

**Decision:** The S5 walking-skeleton scope — `@contextos/mcp-server` initial landing — ships **only** the stdio transport. The Streamable HTTP transport (Hono + @hono/node-server + the full Clerk/solo-bypass/LOCAL_HOOK_SECRET auth chain) is deferred to S16 of the Module 02 implementation plan. As a consequence, HTTP-transport dev deps (`hono`, `@hono/node-server`, `cockatiel`, `@clerk/backend`, `ajv`, `ajv-formats`) are NOT installed in S5; they land in S16 alongside the transport they serve.

**Rationale:** The user's S5 directive was explicit — "S5 is stdio-only. HTTP transport deferred." Landing stdio first gives us a minimal, trusted parent-process channel through which the MCP client can exercise the tool-registration framework end-to-end before we add the auth surface area. Pulling the HTTP deps forward would bloat the dependency graph with code no S5 test exercises, and the Clerk middleware would become dead code carrying latent security expectations — both of which cut against the user's "no scope creep" reading of the plan.

**Alternatives considered:** Land both transports in S5 with the devNullPolicyCheck allowing all HTTP calls (rejected — the auth chain is the harder half of Module 02 and deserves its own slice with real tests, not a walking-skeleton bypass). Land stdio + healthz-only HTTP endpoint in S5 (rejected — splits the transport code across slices with no proportional test coverage).

**Reference:** user S5 approval directive 2026-04-23; `docs/feature-packs/02-mcp-server/implementation.md` S5 re-slice; `apps/mcp-server/README.md` "Current scope" section.

## 2026-04-23 16:25 — `CONTEXTOS_LOG_DESTINATION` env contract + bootstrap side-effect module

**Decision:** `packages/shared/src/logger.ts` is extended to honour the `CONTEXTOS_LOG_DESTINATION` env var at module load. Accepted values: unset (or `stdout`, any case) → pino default stdout; `stderr` → `pino.destination({ fd: 2, sync: true })`; anything else → `TypeError` at module load. `apps/mcp-server/src/bootstrap/ensure-stderr-logging.ts` is the side-effect module imported FIRST in `src/index.ts`; it normalises the env to `stderr` (or refuses to start if the env is explicitly set to anything but `stderr`). `apps/mcp-server/Dockerfile` and `.mcp.json` both set `CONTEXTOS_LOG_DESTINATION=stderr` as defence-in-depth.

**Rationale:** The MCP stdio transport uses stdout EXCLUSIVELY for JSON-RPC frames. A single stray byte — a pino line from any transitive dependency such as `@contextos/db`'s sqlite-vec loader — corrupts the transport and the client disconnects. The fix has to survive ESM's import hoisting: env changes inside `index.ts`'s body would execute AFTER `@contextos/shared/logger` has already resolved its destination. A side-effect module imported at the very top of the import chain is the only reliable pattern for Node ESM. Three enforcement points (bootstrap module, env var, Dockerfile/.mcp.json env) make the invariant auditable and redundant in the right way.

**Alternatives considered:** Call `pino.destination({ fd: 2 })` directly inside the mcp-server (rejected — would not affect transitively-imported `@contextos/db` logs, which use `@contextos/shared`'s `createLogger`). Monkey-patch `console.log`/`console.info` at boot (rejected — brittle, hides bugs, does not affect direct writes to `process.stdout`). Fork the shared logger for the mcp-server (rejected — duplicates the pino config across workspaces and creates two source-of-truth loggers).

**Reference:** user S5 directive "all logs must go to stderr, never stdout — one stray console.log breaks the transport. If packages/shared/src/logger.ts defaults to stdout, override or wrap it in the mcp-server"; `packages/shared/src/logger.ts` docblock; `apps/mcp-server/src/bootstrap/ensure-stderr-logging.ts`; `apps/mcp-server/__tests__/unit/transports/stdio-stdout-purity.test.ts`.

## 2026-04-23 16:28 — Use the SDK's low-level `Server`, not `McpServer.registerTool`

**Decision:** `apps/mcp-server/src/transports/stdio.ts` uses `@modelcontextprotocol/sdk`'s low-level `Server` (`@modelcontextprotocol/sdk/server/index.js`) with `setRequestHandler` against the SDK's exported `ListToolsRequestSchema` and `CallToolRequestSchema`. We explicitly do **not** use the high-level `McpServer.registerTool` API. The SDK tags `Server` as `@deprecated` in favour of `McpServer`; we override that signal.

**Rationale:** Our `ToolRegistry` (`src/framework/tool-registry.ts`) already owns input validation (author-supplied Zod schemas), output validation, the idempotency-key contract, and the automatic policy wrapper. Routing calls through `McpServer.registerTool` would either duplicate that work or split authority across two layers — both outcomes invalidate the "single source of truth for tool invariants" claim the registration framework makes. The SDK's `@deprecated` tag on `Server` means "use `McpServer` unless you have a reason to own the request lifecycle"; our custom registry is exactly that reason.

**Alternatives considered:** Use `McpServer.registerTool` and delete our framework (rejected — we need the synchronous register-time enforcement and the uniform policy/idempotency wrapping; McpServer defers validation to call time and does not wire policy at all). Use `McpServer.registerTool` and have our framework delegate (rejected — layering violation; the framework would become a thin shell that reimplements what McpServer does one level down).

**Reference:** user S5 directive "Tool registration framework must enforce at register time"; `apps/mcp-server/src/transports/stdio.ts` docblock; `External api and library reference.md` → `@modelcontextprotocol/sdk` → Server vs McpServer.

## 2026-04-23 16:32 — Drop `zod-to-json-schema`; use Zod v4 native `z.toJSONSchema`

**Decision:** `apps/mcp-server/src/framework/manifest-from-zod.ts` uses Zod v4's built-in `z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' })`. The previously-pinned third-party `zod-to-json-schema@^3.25.2` (from `docs/feature-packs/02-mcp-server/techstack.md`) is dropped from `apps/mcp-server/package.json` and never installed.

**Rationale:** The original techstack.md was authored when `@contextos/shared` was on Zod v3. Module 01's foundation commit bumped shared to Zod v4 (`^4.3.6`), which ships a native `z.toJSONSchema()` producing JSON Schema 2020-12 output. Keeping Zod and the JSON-Schema emitter under the same library removes a version-coupling hazard (zod-to-json-schema must track zod's internals on every minor release) and halves the install graph for `@contextos/mcp-server`. The native helper's output shape is equivalent to our MCP client expectations — the `manifestFromZod` wrapper enforces `type === 'object'` at runtime so any edge case surfaces loudly.

**Alternatives considered:** Keep `zod-to-json-schema` and ignore Zod v4's native helper (rejected — two libraries doing the same job with different output defaults is a recipe for drift). Use an even-newer third-party like `@sinclair/typebox` (rejected — would require rewriting every schema and is unrelated to the approved techstack). Defer the decision and ship with `zod-to-json-schema` pinned (rejected — the user approved "pin @modelcontextprotocol/sdk exact" and deferring would still leave a stale pin in techstack.md for subsequent slices).

**Reference:** `apps/mcp-server/src/framework/manifest-from-zod.ts` docblock; `apps/mcp-server/__tests__/unit/framework/manifest-from-zod.test.ts`; `External api and library reference.md` → `@modelcontextprotocol/sdk` → Zod v4 compatibility.

## 2026-04-23 16:35 — Dockerfile base image is `node:22.16.0-bookworm-slim` (digest pinned)

**Decision:** `apps/mcp-server/Dockerfile` pins its base image by digest to `node@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34`, resolved 2026-04-23 on the host via `docker pull node:22.16.0-bookworm-slim` + `docker inspect --format='{{index .RepoDigests 0}}'`. The version matches `.nvmrc` (22.16.0). The Dockerfile uses a four-stage build (deps → build → `pnpm deploy` → runtime) and carves out a minimal production tree via `pnpm deploy --prod --legacy` in the third stage.

**Rationale:** Per the user's S5 directive "Do not use alpine — musl breaks native modules (better-sqlite3, sqlite-vec). Use the exact version from .nvmrc. Do not land a TODO on a supply-chain control." `better-sqlite3`'s prebuilt binaries and `sqlite-vec`'s per-platform binaries are both glibc-linked; Alpine's musl would force a source rebuild, adding build-essential + python to the runtime image and losing the binary pin. The Debian Bookworm slim variant is glibc, is actively maintained by the Node image team, and is ~130 MB vs ~900 MB for the full Bookworm image. Pinning by digest (rather than by tag) defends against silent upstream re-tagging — the digest moves only when we consciously re-pull and re-inspect.

**Alternatives considered:** `node:22.16.0-alpine` (rejected — musl, per user). `node:22.16.0-slim` (defaults to Bookworm-slim; same result but less explicit — we prefer the named variant in the `FROM` line). `node:22.16.0-bullseye-slim` (rejected — older Debian release, no meaningful security benefit). Un-pinned `node:22` or `node:22.16.0` (rejected — tags move).

**Reference:** user S5 directive "Do not use alpine…", "base image pinned by digest"; `apps/mcp-server/Dockerfile` FROM lines + docblock.
