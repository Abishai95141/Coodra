# 08 — Implementation Order & Context Pack Protocol

## 8.1 Module build order

Modules MUST be implemented in order. Each depends on the previous ones.

| Module | Name | Depends On | Feature Pack Spec |
|--------|------|-----------|-------------------|
| 01 | Foundation | — | `docs/feature-packs/01-foundation/` |
| 02 | MCP Server (incl. tool manifest per `system-architecture.md` §24) | 01 | `docs/feature-packs/02-mcp-server/` |
| 03 | Hooks Bridge | 01, 02 | `docs/feature-packs/03-hooks-bridge/` |
| 04 | Web App | 01, 02 | `docs/feature-packs/04-web-app/` |
| 05 | NL Assembly | 01, 02 | `docs/feature-packs/05-nl-assembly/` |
| 06 | Semantic Diff | 01, 03 | `docs/feature-packs/06-semantic-diff/` |
| 07 | VS Code Extension | 02, 03, 04 | `docs/feature-packs/07-vscode-extension/` |

## 8.2 Before starting a module

1. Read `spec.md` — understand what you are building and why.
2. Read `implementation.md` — follow the step-by-step plan.
3. Read `techstack.md` — understand the technology choices.
4. Read `docs/research/research_answers.md` — verified API details for Drizzle, pgvector, Supabase, sentence-transformers, tree-sitter, FastAPI, Anthropic SDK, BullMQ, testcontainers, Biome, Turborepo.
5. Read `docs/DEVELOPMENT.md` — local dev setup, service commands, test commands, troubleshooting.

## 8.3 What "complete" means for a module

- All code written and compiling (`pnpm typecheck` passes).
- All tests written and passing (`pnpm test:unit` and `pnpm test:integration`).
- Linting passes (`pnpm lint`).
- Integration with previous modules verified manually.
- Context Pack saved to `docs/context-packs/`.

## 8.4 Context Pack Protocol

After completing any module or significant feature, you MUST save a Context Pack. This is how knowledge transfers between AI agent sessions.

**Save to:** `docs/context-packs/YYYY-MM-DD-module-name.md`

**Template:** `docs/context-packs/template.md`

**What to include:**

- What was built (specific files, functions, endpoints).
- Decisions made (why X instead of Y, with rationale).
- Files created or modified (complete list).
- Tests written (what they cover).
- How integration was verified.
- Known issues or limitations.
- What should be built next.

**How to save it:** call `contextos__save_context_pack` (see `05-agent-trigger-contract.md` §5.9). That call writes the pack to `docs/context-packs/` AND registers it in the MCP store, so future `contextos__search_packs_nl` calls can find it.

**This is not optional.** Context Packs are the memory of the project. Without them, the next agent session starts from zero.
