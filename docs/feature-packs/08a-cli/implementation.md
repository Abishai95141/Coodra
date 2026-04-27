# Module 08a — CLI — Implementation Plan

> Read `spec.md` and `techstack.md` first. This file is the step-by-step plan; spec is what + why, techstack is which-libraries-and-versions, this file is the order of operations.

> **Open-question gate — CLOSED 2026-04-27.** All five open questions in `spec.md` §11 are signed off (Decisions 1–5) and locked in this spec via S0. Slices below that previously named an OQ now reference the locked decision number.

> **Integration-harness invariant.** The M03 closeout established two manual integration harnesses under `__tests__/manual/` (`verify-f5-live.ts`, `verify-phase5-closed-loop.ts` — see `__tests__/manual/README.md`). Every CLI slice that touches the DB, the bridge config files, or the auto-migrate path must leave both harnesses green. Each slice's "Tests" section names the harness call it ran.

The plan splits Module 08a into 10 slices (S0–S9). Each slice is one feat commit on `feat/08a-cli`. Squash-merge to `main` only after the final S9 Context Pack lands.

## S0 — Open-question sign-off + branch open ✓ (landed 2026-04-27)

User's reply locked all five OQs at the recommended answer. Same-commit edits to `spec.md` §11 convert each "Recommendation preview" into Decision N. `feat/08a-cli` opens off `feat/03-hooks-bridge` HEAD (`53be96a` — M03 work + M08a triplet). DEVELOPMENT.md gains a "### Iterating on the CLI (Module 08a)" subsection per the kickoff add-on (contributor dev-loop without `npm i -g`).

**Commit:** `docs(08a-cli): lock open-question answers from kickoff sign-off`.

## S1 — Package scaffold

Create `packages/cli/` (workspace package) with:

- `packages/cli/package.json` — `name: "@contextos/cli"`, `bin: { "contextos": "./dist/index.js" }`, `type: "module"`, `engines.node: ">=22.16.0"`. Pinned deps per `techstack.md`. Workspace deps on `@contextos/shared` and `@contextos/db`.
- `packages/cli/tsconfig.json` — extends repo base, `rootDir=src`, `outDir=dist`.
- `packages/cli/tsconfig.typecheck.json` — includes tests.
- `packages/cli/vitest.config.ts` — v8 coverage, 80% thresholds.
- `packages/cli/src/index.ts` — `#!/usr/bin/env node` shebang, top-level commander program, no command bodies yet (each command exists as a stub that prints "not yet implemented" and exits 99).

**Commit:** `feat(cli): scaffold @contextos/cli — workspace package + commander surface`.

## S2 — `contextos --help` and `--version`

Wire commander metadata, version pulled from `package.json` at build time (no runtime `JSON.parse` of `package.json` — ship a generated `src/version.ts` written by a `prebuild` script). Each subcommand registers its `--help` block.

Tests: snapshot tests for `--help` output (locked text), `--version` returns the correct semver.

**Commit:** `feat(cli): --help and --version surfaces with snapshot-locked text`.

## S3 — `contextos doctor` (the diagnostic engine + 20 checks per spec §4.5)

Implement `doctor` as a registry of `Check` records (`{ id, name, severity, run: (ctx) => Promise<CheckResult> }`) and a runner that executes them in parallel with a per-check timeout (default 2s, configurable via `--timeout-ms`).

The 20 checks specified in `spec.md` §4.5 land here. Most are environment checks; six are the M03 post-merge invariant checks that distinguish this CLI from a generic dev-tool installer:

- **Check 5** — `__global__` sentinel project exists (F7 closure live).
- **Check 6** — recent `policy_decisions` rows have the F14 4-segment idempotency key shape.
- **Check 7** — recent `run_events` rows have `run_id NOT NULL` when their session has a `runs` row (F8).
- **Check 8** — bridge `pre_tool_use_decision` log lines from the last 24h include `runId` (F15 spot-check).
- **Check 13** — Audit-write durability YELLOW until M03.1 lands. Permanent yellow until that module ships; the check exists so M03.1's landing flips this to GREEN automatically.
- **Check 12** — project registered for cwd (`.contextos.json` resolves) — the F7-related governance pre-condition.

Each check is a separate file under `packages/cli/src/doctor/checks/<id>.ts` so tests target one check at a time. The runner is `src/doctor/run.ts`.

Output format: numbered list with green ✓ / yellow ⚠ / red ✗ glyphs, one-line remediation per non-green, like the M03 F-fix register table format. `--json` emits `{ checks: [{ id, name, severity, status, remediation? }], summary: { ok, warn, fail }, version }`. Reds → exit 2; yellows-only → exit 1; all-green → exit 0.

Tests:
- Each check has its own unit test exercising green AND each failure path. Tests for checks 5–8 use a real testcontainers SQLite fixture with seeded F7/F8/F14 fixtures (correct + broken).
- Integration test: spawn `node dist/index.js doctor --json` against a tmpdir set up to fail multiple checks; assert the JSON output structure and exit code.
- Integration-harness invariant: re-run `__tests__/manual/verify-phase5-closed-loop.ts` after this slice; doctor must report all-green when the harness has just succeeded.

**Commit:** `feat(cli): doctor — 20-check diagnostic engine surfacing F7/F8/F14/F15 invariants`.

## S4 — Project + IDE detection module

`packages/cli/src/lib/detect.ts` exposes pure functions:

- `detectProjectRoot(cwd: string): Promise<string>` — walks up looking for `package.json`, `pyproject.toml`, `Cargo.toml`, `.git`. Returns the deepest match.
- `detectLanguages(root: string): Promise<Language[]>` — file-extension scan with Glob, returning a deduped list.
- `detectIDE(): Promise<IDE[]>` — checks `~/.claude/`, `~/.cursor/`, `~/.windsurf/` existence.
- `detectExistingMCPConfig(root: string): Promise<MCPConfig | null>` — reads `.mcp.json` if present, validates with Zod, returns parsed object or null.

Every function pure (no side effects). Every function unit-tested against fixture directories under `__tests__/fixtures/`.

**Commit:** `feat(cli): detect — project root, languages, IDE, existing .mcp.json`.

## S5 — `contextos init` (the first-time setup command)

Wires S4's detection into a command that:

1. Calls `detectProjectRoot` → fails with code 1 + clear message if no root found.
2. Calls `detectLanguages` + `detectIDE` → prints the detected facts (each on a `✓ Detected ...` line).
3. Resolves `~/.contextos/` location per spec §11 Decision 2 (XDG on Linux when `$XDG_CONFIG_HOME` is set, `$HOME/.contextos/` default elsewhere) via `env-paths` configured `{ suffix: '' }`.
4. Resolves `--project-slug` (CLI flag) OR derives from `path.basename(root)` (sanitized to slug-safe chars).
5. Creates `~/.contextos/{data.db,logs/,pids/}` per `spec.md §4.1`. Runs auto-migrate on `data.db` via `@contextos/db::migrateSqlite`. Calls `ensureGlobalProject(handle)` to seed the F7 sentinel project.
6. Reads existing `.mcp.json` if present; collision behavior per spec §11 Decision 3 (idempotent merge by default — inspect, leave alone if correct, merge if drift detected; `--force` overrides to baseline). Each file's outcome stamped with `action: 'wrote' | 'merged' | 'unchanged' | 'forced'` in the `--json` output for CI consumers.
7. The ContextOS `.mcp.json` entry uses the stdio command form. Path resolution per spec §11 Decision 5 (standalone npm package `@contextos/cli`): a global `npm i -g @contextos/cli` install resolves to the `contextos` bin in the global node_modules; `npx`-style invocation embeds the npx-cache path (caught as YELLOW by S3 doctor check 14).
8. Writes `<repo>/.contextos.json` with `{ "projectSlug": "<derived or --project-slug>" }` so the bridge's `projectSlugResolver` finds it.
9. Writes/merges `<repo>/.env` with the solo-mode sentinels listed in `spec.md §4.1`. Existing `.env` lines are preserved; only ContextOS-specific keys are added/updated. Generates a fresh `LOCAL_HOOK_SECRET` via `crypto.randomBytes(32).toString('hex')` for the solo-mode bypass — never a literal sentinel string per `essentialsforclaude/02-agent-human-boundary.md` §2.4.
10. Creates `docs/feature-packs/<slug>/` if absent. Writes `meta.json` with `{ slug, parentSlug: null, sourceFiles: [auto-derived from detected languages], isActive: true }`. Writes a `spec.md` skeleton (200-line template with TODO markers).
11. Optionally invokes Graphify scan (skipped if `--no-graphify` or if the binary is absent on PATH; logs YELLOW warning in that case but does not fail). When run, the graph output enriches the seeded `spec.md` via a deterministic template — no LLM calls in 08a.
12. Calls `start` internally unless `--dry-run`.
13. Prints the final ready banner with the four bullet points from `spec.md` §5.

Idempotency contract per spec §11 Decision 3 (idempotent merge default; `--force` destructive).

Tests:
- Unit tests against tmp project dirs covering: greenfield (no `.mcp.json`, no `.contextos.json`), existing `.mcp.json` with another MCP server (idempotent merge keeps the other entry), existing `docs/feature-packs/` with a different slug (conflict path), Graphify-absent path, `--dry-run`, idempotent re-run (no destructive writes, expected `action: 'unchanged'` outcomes), `--force` re-run (writes baseline, expected `action: 'forced'` outcomes).
- Integration test: drive `init` against a tmpdir, then immediately drive the **`__tests__/manual/verify-phase5-closed-loop.ts`** harness against the resulting bridge config — must succeed with one `runs` row (F8/F9/F14 invariants live). This proves `init` produces a config the rest of the system will accept.
- The `init`-writes-sentinels-only assertion: a unit test parses the written `.env` and fails if any of the disallowed keys (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `GITHUB_APP_*`, `ATLASSIAN_*`, `SUPABASE_*`, `UPSTASH_*`) appear with a non-empty value. Per spec §6 "agent-human boundary."

**Commit:** `feat(cli): init — auto-migrate + ensureGlobalProject + .mcp.json merge + Feature Pack seed + Graphify enrichment`.

## S6 — Daemon manager abstraction

`packages/cli/src/lib/daemon/{launchd,systemd,taskscheduler,fallback}.ts` — one module per platform implementing a common interface:

```typescript
interface DaemonManager {
  isAvailable(): Promise<boolean>;
  install(unit: DaemonUnit): Promise<void>;
  uninstall(unitName: string): Promise<void>;
  start(unitName: string): Promise<void>;
  stop(unitName: string): Promise<void>;
  status(unitName: string): Promise<DaemonStatus>;
  list(): Promise<DaemonStatus[]>;
}
```

The `fallback.ts` implementation uses a detached child process + a PID file under `~/.contextos/pids/` and is the implementation that runs on Windows in 08a (Task Scheduler integration deferred).

A factory `selectDaemonManager(): Promise<DaemonManager>` picks the right one for the current OS, falling back to `fallback.ts` when the native manager is unreachable.

Each implementation gets unit tests (mocking the underlying CLI: `launchctl`, `systemctl`, `schtasks`) and an opt-in integration test gated behind `CONTEXTOS_TEST_DAEMON=1` that runs against the actual native manager — only enabled in CI on the matching OS runner.

**Commit:** `feat(cli): daemon — launchd / systemd / Task-Scheduler / fallback abstraction`.

## S7 — `contextos start` and `contextos stop`

`start` walks: select daemon manager → install MCP-server unit + Hooks-Bridge unit → start both → wait for `/health` to return ok within 10 s per service → print success.

`stop` walks: list installed ContextOS units → stop each → optionally uninstall (`--uninstall` flag). Idempotent.

Health-check polling uses `@contextos/shared`'s logger and an exponential backoff capped at 1s.

Tests: integration tests in CI on macOS + Linux runners exercising the full `start` → `status` → `stop` cycle against a real (small) MCP server binary checked into a fixtures directory. Tests skip on Windows runner with a TODO comment.

**Commit:** `feat(cli): start + stop — daemon lifecycle for MCP server and Hooks Bridge`.

## S8 — `contextos status` (unified) + `contextos team login` / `team logout` stubs

`status` is the **unified state probe** described in `spec.md §4.6` — it merges:
- **Project state**: read `<cwd>/.contextos.json` → resolve to a `projects` row → fetch the most recent `runs` row + `last decisions.created_at` + scan `context_memory/blockers.md` for non-empty entries.
- **Service state**: live HTTP probe of MCP server `/healthz` and bridge `/healthz` (no daemon-manager `list()` reliance — that path is fragile per the M02 finding around stale subprocess state).

Renders both sections in one screen per the example in `spec.md §4.6`. `--json` emits the structured object. No cache; every call is a live probe (sub-200ms target).

`team login` / `team logout` per spec §11 Decision 1 — **stubs in 08a**:
- Both commands exist with the full flag set per `spec.md` §4 + each subcommand's `--help` text.
- Bodies print "team mode not yet generally available — the OAuth round-trip + `~/.contextos/config.json` write land when team mode is reachable end-to-end (post-Module 04). Track via `pending-user-actions.md`." and exit 2.
- The OAuth body + secret-write path are explicitly NOT in S8's scope and ship in the team-mode-launch slice without changing the command name, flags, or exit codes.

Tests:
- `status` against four states: (all running + project registered) / (services down + project registered) / (running + cwd unregistered → falls to `__global__`) / (nothing running, no `init` ever run).
- `--json` output schema lock (zod-validated test fixture).
- `team login` / `team logout` snapshot tests asserting exit 2 + the deferred-body message + `--help` text.
- Integration-harness invariant: after `init` + `start` (S7) lands, run `verify-phase5-closed-loop.ts`, then drive `status` — must report all-green and the recent-runs entry must show the closed-loop run.

**Commit:** `feat(cli): status — unified project + service probe; team login / logout per OQ 1`.

## S9 — README, npm-pack dry run, Module 08a Context Pack

Write `packages/cli/README.md` covering: install, the 7 commands with one-line each, link back to `docs/feature-packs/08a-cli/spec.md` for the full surface.

Run `pnpm --filter @contextos/cli pack --dry-run` and verify the tarball includes `dist/`, `package.json`, `README.md`, `LICENSE` and EXCLUDES `src/`, `__tests__/`, `node_modules/`. Lock the file list with a unit test that grep-asserts the output.

Save `docs/context-packs/YYYY-MM-DD-module-08a-cli.md` per `essentialsforclaude/08-implementation-order.md` §8.4.

**Commit:** `docs(08a-cli): README + npm-pack file-list lock + Module 08a Context Pack`.

## After S9 — what gets unblocked

- Module 04 (Web App) can build its onboarding flow knowing the CLI exists. The web app's "Get Started" page reduces to "run `npx @contextos/cli init` then `contextos team login <invite-token>` (when team mode opens)" — exact CLI name locked per spec §11 Decision 1.
- Module 07 (VS Code Extension) can shell out to `contextos start` / `stop` / `status` for service control without re-implementing daemon management.
- The `pending-user-actions.md` entry "LOCAL_HOOK_SECRET config-file reads via a future contextos team login CLI" updates to "command surface lives in 08a as stub; OAuth round-trip + secret-write body land when team mode opens" — fully closes when team mode launches.

## Per-slice integration-harness gate (recap)

Slices that touch DB / bridge config / auto-migrate paths must leave both manual harnesses green at slice end. Map:

| Slice | Touches | Harness must pass after slice |
|---|---|---|
| S3 (doctor) | reads DB, reads bridge logs | `verify-f5-live.ts` (no impact expected) |
| S5 (init) | writes DB, writes `.contextos.json`, writes `.mcp.json`, writes `.env` | `verify-phase5-closed-loop.ts` against the just-init'd project |
| S7 (start/stop) | starts/stops bridge + MCP | `verify-phase5-closed-loop.ts` end-to-end |
| S8 (status) | reads bridge + MCP via /healthz | both harnesses |

If a harness regresses, the slice does not commit. Fix-or-revert before proceeding.

## Doc reconciliations required in this module's commits

- `system-architecture.md §13` "Process management: PIDs written to `~/.contextos/pids`" expands to "PIDs written to `~/.contextos/pids/`; on macOS / Linux the daemon is also registered with the platform's native manager (launchd / systemd) so it survives reboot." Same-commit edit per amendment B in S6 or S7.
- `system-architecture.md §1` is amended at S5 per spec §11 Decision 2 ("`~/.contextos/` may resolve to `$XDG_CONFIG_HOME/contextos/` on Linux when set; defaults to `$HOME/.contextos/` everywhere otherwise").
- `essentialsforclaude/08-implementation-order.md` §8.1 already inserts Module 08a between 03 and 04 — confirm during S0 that this is still correct after the M03.1 placeholder landed.
