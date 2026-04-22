# ContextOS — Development Guide

This is the single page you need to get a local ContextOS monorepo
running, make a change, and ship it through the same pipeline CI uses.
It is intentionally short: anything that would bloat it belongs in a
Feature Pack (`docs/feature-packs/<id>/`) or in the canonical
standing-context docs at the repo root (`system-architecture.md`,
`essentialsforclaude/`, `module-wise plan.md`,
`External api and library reference.md`, `implementation plan and strategy.md`).

## Prerequisites

- **Node.js** exactly at the version pinned in `.nvmrc` (22.x). Use
  `nvm use` or `fnm use` — the CI workflow reads the same file.
- **pnpm 10+** (`corepack enable && corepack prepare pnpm@latest`).
- **Docker + Docker Compose** for the Postgres + Redis services in
  team mode and for integration tests.
- **git** ≥ 2.40. Make sure your commits sign cleanly if the project
  has signed-commits enforcement (none today; Module 05 may add it).

## First-time setup

```bash
git clone git@github.com:Abishai95141/Coodra.git
cd Coodra
nvm use                 # picks the version from .nvmrc
corepack enable
pnpm install            # resolves workspaces + runs postinstalls
pnpm --filter @contextos/shared build   # builds the workspace package
                                        # that others import
```

That is enough to run `pnpm lint`, `pnpm typecheck`, and
`pnpm test:unit`. Integration work needs Postgres:

```bash
docker compose up -d             # brings up postgres + redis
# Wait ~5 s for health-checks, then:
export DATABASE_URL="postgres://contextos:contextos_dev_password@127.0.0.1:5432/contextos"
export REDIS_URL="redis://127.0.0.1:6379/0"
pnpm test:integration            # currently: @contextos/db Postgres smoke
```

Stop and reset:

```bash
docker compose down -v           # removes named volumes too
```

## Monorepo layout

```
packages/
  shared/                 # @contextos/shared — logger, errors, zod env, idempotency
  db/                     # @contextos/db     — Drizzle schemas (sqlite + postgres), createDb
  # (Module 02+ adds: mcp-server, hooks-bridge, ai-core, sync-daemon, ui, cli)

docs/
  DEVELOPMENT.md          # this file
  feature-packs/<NN>-*/   # spec, implementation plan, techstack per module
  context-packs/          # run-after-run summaries; the primary handoff artefact

context_memory/           # per-session working notes (gitignored bodies, committed structure)
```

Every workspace package follows the same shape:
`src/` for implementation, `__tests__/unit/` and
`__tests__/integration/` for tests, `tsconfig.json` for the build
(rootDir=src), `tsconfig.typecheck.json` for everything-else
typechecking, and a `package.json` whose `exports` maps
subpaths for consumers.

## Daily workflow

The commands you actually run:

```bash
pnpm lint               # biome check across the repo
pnpm lint:fix           # biome check --write
pnpm typecheck          # turbo run typecheck (builds deps first)
pnpm test:unit          # turbo run test:unit across workspaces
pnpm test:integration   # turbo run test:integration (needs Postgres)
pnpm build              # turbo run build
pnpm --filter @contextos/db db:generate   # regenerate Drizzle migrations
```

All of these are the same commands CI runs. If they pass locally they
pass in CI.

### Running a single package

```bash
pnpm --filter @contextos/shared test:unit
pnpm --filter @contextos/db typecheck
```

### Regenerating Drizzle migrations

After changing `packages/db/src/schema/{sqlite,postgres}.ts`:

```bash
pnpm --filter @contextos/db db:generate
```

Commit both the schema change and the generated SQL in the same commit.
The schema-parity unit test
(`packages/db/__tests__/unit/schema-parity.test.ts`) will fail CI if
the two dialects drift in a way that is not explicitly allow-listed in
the test's `DIALECT_TYPE_EXEMPTIONS` map.

### Migration lock (hand-written preserve-blocks)

Some SQL that the database needs cannot be emitted by Drizzle-Kit —
today: the `sqlite-vec` virtual-table DDL (SQLite) and the pgvector
HNSW index DDL (Postgres). These live inside the Drizzle-generated
migration files, wrapped in preserve markers:

```sql
-- @preserve-begin hand-written:<marker>
<hand-written SQL>
-- @preserve-end hand-written:<marker>
```

Every marked block is sha256-locked in
`packages/db/migrations.lock.json` with `{ file, blockMarker, sha256,
lineRange, generatedAt }`. CI (`.github/workflows/ci.yml` → `verify`
job) and the `.githooks/pre-commit` hook both run the checker:

```bash
pnpm --filter @contextos/db run check:migration-lock
```

The checker surfaces three failure modes, each with a diffable
message naming the file, the marker, the expected sha256, and the
remediation command:

- `MISSING_IN_FILE` — the block is gone (Drizzle-Kit regenerated and
  wiped it). Restore from git: `git log -p <migration>`.
- `MISSING_IN_LOCK` — a new hand-written block was added without
  running `--write`. Run it and commit.
- `SHA256_MISMATCH` — the body drifted. If the edit was intentional,
  regenerate the lock:

  ```bash
  pnpm --filter @contextos/db run check:migration-lock -- --write
  git diff packages/db/migrations.lock.json   # sanity check
  git add packages/db/migrations.lock.json
  ```

Pre-commit only runs the check when files under `packages/db/` are
staged; CI always runs it. The hook is wired automatically by `pnpm
install` (root `prepare` script sets `core.hooksPath` to `.githooks`).

## Branching, commits, and the session protocol

Per the standing context (`CLAUDE.md`, `system-architecture.md` §24),
each module is delivered on a feature branch named `feat/<NN>-<slug>`
(e.g. `feat/01-foundation`). Inside that branch, commits are split by
logical slice, each self-contained and runnable.

At the end of every session, regardless of whether the module is
complete:

1. Update `context_memory/current-session.md` with a terse timeline.
2. Update `context_memory/decisions-log.md` if any non-trivial
   decision was made in this session.
3. Write a Context Pack to
   `docs/context-packs/YYYY-MM-DD-module-NN-<title>.md` using
   `docs/context-packs/template.md`.
4. Call `contextos__save_context_pack` with the Pack's markdown body
   so future sessions can retrieve it via semantic search.

Never close a session on a broken `pnpm lint` / `typecheck` /
`test:unit`. If you must stop mid-slice, `git stash` or leave the work
on a scratch branch — `main` and active feature branches stay green.

## Module workflow — at a glance

The full sequence for shipping a module is documented in
`module-wise plan.md` (§"Module workflow") and the root-level
`CLAUDE.md`. The short version:

1. Read the standing context. Ask clarifying questions *before*
   writing code if the Feature Pack leaves anything ambiguous.
2. Produce `docs/feature-packs/<NN>-<slug>/{spec,implementation,techstack}.md`
   and get explicit approval before implementing.
3. Implement slice-by-slice with tests landing in the same commit as
   the code they cover.
4. Keep `External api and library reference.md` updated in the **same
   commit** where a pin changes (amendment B of the bootstrap plan).
5. End with a Context Pack. Merge the feature branch to `main` only
   after CI is green.

## Troubleshooting

- **`Cannot find module '@contextos/shared'`** — rebuild the workspace
  package: `pnpm --filter @contextos/shared build`. Turbo's
  `typecheck` task depends on `^build`, so `pnpm typecheck` from the
  root handles it automatically.
- **`better-sqlite3` native build failure** — ensure your Node matches
  `.nvmrc` (native ABI); run `pnpm rebuild better-sqlite3`.
- **Integration tests hang or fail to connect** — check
  `docker compose ps` and make sure the Postgres container is
  `healthy`. The port `5432` must be free on the host.
- **Drizzle-kit can't find the schema file** — you probably ran it
  from the repo root; every `db:*` script is defined in
  `packages/db/package.json` and must be invoked via
  `pnpm --filter @contextos/db ...`.

## Pointers

- Canonical architecture — `system-architecture.md`
- Discipline and style — `essentialsforclaude/01-development-discipline.md`
  and `essentialsforclaude/07-style-and-conventions.md`
- Per-module workflow — `module-wise plan.md`
- Dep pins + gotchas — `External api and library reference.md`
- Session notes — `context_memory/current-session.md`
- Feature Pack for this module — `docs/feature-packs/01-foundation/`
