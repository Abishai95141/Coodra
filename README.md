# Coodra

> **MCP server platform that gives AI coding agents (Claude Code, Cursor, Windsurf) project context, memory across sessions, and policy enforcement — so they stop coding blind.**

[![CI](https://github.com/Abishai95141/Coodra/actions/workflows/ci.yml/badge.svg)](https://github.com/Abishai95141/Coodra/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@coodra/cli/beta.svg)](https://www.npmjs.com/package/@coodra/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is Coodra?

Coodra is a coordination layer between human architects and AI coding agents. It runs as a local-first MCP (Model Context Protocol) server and gives every agent session three things:

- **Feature Packs** — the architectural blueprint for the module the agent is touching, injected automatically at session start.
- **Context Packs** — the durable record of every decision, file change, and policy event from past sessions, queryable in natural language.
- **Policy enforcement** — pre-tool-use checks (e.g. *deny writes to `.env.production`*) recorded in an audit trail.

It works in two modes:

- **Solo** — everything on your laptop, SQLite-backed, zero network. Default after `coodra init`.
- **Team** — cloud-synced via Postgres + pgvector + Clerk auth, so decisions and context flow between teammates.

---

## Quick start

```bash
# Install
npm i -g @coodra/cli@beta

# In any project directory
coodra init      # writes ~/.coodra/, .mcp.json, CLAUDE.md, feature pack
coodra start     # launches the MCP server + hooks bridge as daemons
coodra doctor    # 20-check health report
```

That's it. Open Claude Code (or Cursor / Windsurf) in the project and the agent will pick up the Feature Pack on its first turn.

Full CLI reference: [`packages/cli/README.md`](packages/cli/README.md)

---

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────────┐
│  Agents (Claude Code, Cursor, Windsurf)                             │
└──────────────────────┬──────────────────────┬───────────────────────┘
                       │ MCP                  │ Hooks
                       ▼                      ▼
            ┌──────────────────┐    ┌────────────────────┐
            │   MCP Server     │    │   Hooks Bridge     │
            │   :3100          │    │   :3101            │
            │  (26 tools)      │    │  pre/post/start/end│
            └────────┬─────────┘    └────────┬───────────┘
                     │                       │
                     └──────────┬────────────┘
                                ▼
                  ┌─────────────────────────┐
                  │  SQLite (~/.coodra)     │  ← solo
                  │  + Postgres + pgvector  │  ← team
                  └─────────────────────────┘
```

| Service | Path | Language | Purpose |
|---|---|---|---|
| MCP Server | [`apps/mcp-server`](apps/mcp-server) | TypeScript | 26 MCP tools — feature packs, context packs, policy, run history |
| Hooks Bridge | [`apps/hooks-bridge`](apps/hooks-bridge) | TypeScript (Hono) | Receives Claude Code / Cursor lifecycle hooks; enforces policy in-line |
| Sync Daemon | [`apps/sync-daemon`](apps/sync-daemon) | TypeScript | Bi-directional cloud sync for team mode |
| Web | [`apps/web-v2`](apps/web-v2) | Next.js 15 | Admin + audit-trail UI (solo + team) |
| CLI | [`packages/cli`](packages/cli) | TypeScript | The published `@coodra/cli` npm package |

The full system design lives in [`system-architecture.md`](system-architecture.md) (25 sections, source of truth for service boundaries, data flow, and CAP/SLA analysis).

---

## Repository layout

```
apps/                     # Runtime services
  mcp-server/             # MCP Server (TypeScript SDK)
  hooks-bridge/           # Claude Code / Cursor hook receiver
  sync-daemon/            # Team-mode cloud sync
  web-v2/                 # Admin UI (Next.js 15)
  web/                    # ⚠ Deprecated — see apps/web/DEPRECATED.md

packages/
  cli/                    # The @coodra/cli npm package (published)
  db/                     # Drizzle schema + migrations (SQLite + Postgres)
  policy/                 # Policy decision engine
  shared/                 # Cross-cutting Zod schemas, auth, logging

docs/
  DEVELOPMENT.md          # Local dev setup, service commands, testing
  feature-packs/          # Per-module specs (spec.md / implementation.md / techstack.md)
  context-packs/          # Permanent record of completed work
  audit/                  # Audit reports
  verification/           # Verification run findings
  archive/                # Older planning docs (kept for history)

deploy/                   # Dockerfiles for cloud deploys (team mode)
scripts/                  # Operational scripts (hook adapters, cleanup utilities)
essentialsforclaude/      # Standing agent rules (auto-loaded by CLAUDE.md)
```

---

## Development

```bash
# Setup
pnpm install
pnpm rebuild        # build better-sqlite3 + sqlite-vec native bindings

# Tests
pnpm typecheck      # all 9 workspace projects
pnpm test:unit      # 1,160 tests across the workspace
pnpm test:integration   # postgres migrations + auth chain (needs Docker)
pnpm test:e2e       # full-session lifecycle (needs Docker)

# Lint / format
pnpm lint           # biome check
pnpm lint:fix       # biome check --write

# Build the publishable CLI tarball
pnpm --filter @coodra/cli build
```

Detailed dev loops, troubleshooting, and service commands: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

---

## Contributing

Coodra is open source under MIT. PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the developer workflow, commit conventions, and how the standing agent rules in [`essentialsforclaude/`](essentialsforclaude/README.md) shape day-to-day work.

---

## License

MIT — see [`LICENSE`](LICENSE).
