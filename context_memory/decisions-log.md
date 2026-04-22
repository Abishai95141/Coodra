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
