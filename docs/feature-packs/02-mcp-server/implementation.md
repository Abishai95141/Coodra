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

### S5 — Bootstrap `apps/mcp-server` package

Create `apps/mcp-server/package.json` (private, `"type": "module"`, `main: dist/index.js`, bin `"contextos-mcp-server": "dist/index.js"`), `apps/mcp-server/tsconfig.json` (extends `../../tsconfig.base.json`, `rootDir: src`, `outDir: dist`, `types: ["node"]`), `apps/mcp-server/tsconfig.typecheck.json` (extends `./tsconfig.json`, `rootDir: .`, `noEmit`, includes `__tests__`), `apps/mcp-server/vitest.config.ts`, `apps/mcp-server/vitest.integration.config.ts`, `apps/mcp-server/README.md` (one-page pointer to `docs/DEVELOPMENT.md#mcp-server`).

Install the Module-02 deps:

```bash
pnpm --filter @contextos/mcp-server add @modelcontextprotocol/sdk@^1.29.0 hono@^4.12.14 @hono/node-server@^2.0.0 cockatiel@^3.2.1 zod-to-json-schema@^3.25.2 @clerk/backend@^3.2.13
pnpm --filter @contextos/mcp-server add -D ajv@^8.18.0 ajv-formats@^3.0.1 testcontainers@^11.14.0 @testcontainers/postgresql@^11.14.0
```

Update `pnpm-workspace.yaml` is not needed — the `apps/*` glob is already in place from Module 01.

Add `scripts.dev = "tsx watch src/index.ts"`, `scripts.build = "tsc -p tsconfig.json"`, `scripts.test:unit = "vitest run"`, `scripts.test:integration = "vitest run --config vitest.integration.config.ts"`, `scripts.lint = "biome check ."`, `scripts.typecheck = "tsc -p tsconfig.typecheck.json"`.

**Reference updates in the same commit** (amendment B):

- `External api and library reference.md` — new **Model Context Protocol** subsection under Protocols & Transports: pin `@modelcontextprotocol/sdk@^1.29.0`; add server-registration snippet and stdio + Streamable HTTP setup snippet.
- `External api and library reference.md` — Hono section: pin `^4.12.14` (replaces the "verify via npm view" placeholder).
- `External api and library reference.md` — `@hono/node-server` section: pin `^2.0.0` (major bump from `1.19.3`; flag that `serve({ fetch, port })` signature is unchanged for our usage).
- `External api and library reference.md` — cockatiel section: pin `^3.2.1` (minor bump from `3.1.3`).
- `External api and library reference.md` — new **Clerk backend SDK** entry under Auth & Security: pin `@clerk/backend@^3.2.13`; add `authenticateRequest()` snippet.
- `External api and library reference.md` — new **Ajv** entry under Validation/Schemas/Resilience: pin `ajv@^8.18.0`, `ajv-formats@^3.0.1`.
- `External api and library reference.md` — new **Testing & Containers** section: pin `testcontainers@^11.14.0`, `@testcontainers/postgresql@^11.14.0`.

**Files:** everything under `apps/mcp-server/` listed above, `External api and library reference.md`.

**Commit:** `feat(mcp-server): bootstrap apps/mcp-server (deps, tsconfig, vitest)`.

### S6 — Tool-registration framework

`apps/mcp-server/src/tools/index.ts` — pure reducer over the seven/eight `manifest.ts` exports, returns the sorted `tools/list` response; throws at module-load time if duplicate names are detected.

`apps/mcp-server/src/lib/manifest-from-zod.ts` — wraps `zodToJsonSchema` with ContextOS-specific options (`$refStrategy: 'none'`, `target: 'jsonSchema7'`) so MCP clients don't need to resolve `$ref`s. Unit test asserts round-trip Ajv validity on a few representative Zod schemas.

`apps/mcp-server/__tests__/helpers/manifest-assertions.ts` — shared §24.3 assertion helper used by per-tool `manifest.test.ts` files. Asserts: starts with "Call this" (case-insensitive), word count 40–120 (§24.3 soft-target 40–80 / hard-max 120 per Q-02-6), `length < 800`, contains "Returns" (or explicit return-shape tag), `name` matches the folder name (hyphen → underscore).

**Commit this commit also updates `system-architecture.md` §24.3** to the amended wording "40–80 word soft target, 120-word hard maximum" per Q-02-6. Per amendment B, the doc change and the test change land in the same commit.

**Files:** `apps/mcp-server/src/tools/index.ts`, `apps/mcp-server/src/lib/manifest-from-zod.ts`, `apps/mcp-server/__tests__/unit/lib/manifest-from-zod.test.ts`, `apps/mcp-server/__tests__/helpers/manifest-assertions.ts`, `system-architecture.md` §24.3.

**Commit:** `feat(mcp-server): tool-registration framework + manifest-from-zod helper`.

### S7a — Lib: infra primitives

`apps/mcp-server/src/lib/db.ts` — re-exports a memoised `createDb()` call that reuses Module 01's `@contextos/db` factory. Test asserts mode dispatch + single-instance behaviour.

`apps/mcp-server/src/lib/env.ts` — extends `@contextos/shared`'s `baseEnvSchema` via Zod `superRefine`:

- Adds `MCP_SERVER_PORT` (default 3100), `LOCAL_HOOK_SECRET` (optional), `CLERK_PUBLISHABLE_KEY` (optional), `CLERK_SECRET_KEY` (optional), `CLERK_JWT_ISSUER` (optional — defaults to Clerk's `https://clerk.<tenant>.dev` pattern; set in team mode).
- **Strictness (per addition C):**
  - solo mode OR `CLERK_SECRET_KEY === 'sk_test_replace_me'` → Clerk keys optional.
  - team mode AND `CLERK_SECRET_KEY !== 'sk_test_replace_me'` → **both** required, AND `CLERK_SECRET_KEY` must match `/^sk_(test|live)_/`, AND `CLERK_PUBLISHABLE_KEY` must match `/^pk_(test|live)_/`.
- Failure is a startup `ValidationError` from `@contextos/shared` with a pointer to which env var is wrong.

`apps/mcp-server/src/lib/logger.ts` — thin wrapper that calls `@contextos/shared`'s `createLogger('mcp-server', { runId, sessionId })`. Re-exported so downstream lib modules import one place.

`apps/mcp-server/src/lib/errors.ts` — adapters that translate `@contextos/shared`'s `AppError` hierarchy into MCP tool-return shapes (`{ content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }], isError: true }`). Unit test covers every `AppError` subclass.

**Env-shape regression test** (addition D): `apps/mcp-server/__tests__/unit/lib/env.test.ts` with four fixtures — **valid-solo** (all defaults; no Clerk keys), **valid-team** (real `sk_test_...` + `pk_test_...`), **missing-clerk-in-team** (must throw `ValidationError` with the Clerk error message), **malformed-port** (`MCP_SERVER_PORT=abc`, must throw). Locks the contract.

**Files:** `apps/mcp-server/src/lib/db.ts`, `apps/mcp-server/src/lib/env.ts`, `apps/mcp-server/src/lib/logger.ts`, `apps/mcp-server/src/lib/errors.ts`, matching unit tests under `apps/mcp-server/__tests__/unit/lib/`.

**Commit:** `feat(mcp-server): lib infra — db, env (Clerk-strict), logger, errors`.

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
