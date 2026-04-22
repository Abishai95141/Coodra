# 11 — Architectural Decision Records (ADRs)

These are the 11 load-bearing technology/design decisions that future sessions must not silently overturn. New decisions are recorded via `contextos__record_decision` (see `05-agent-trigger-contract.md` §5.4) and appended to `context_memory/decisions-log.md` — the latter accumulates; this file only lists the foundational 11.

## ADR-001 — TypeScript MCP SDK over Python

The MCP Server uses the TypeScript SDK (`@modelcontextprotocol/sdk`) with Streamable HTTP transport. TypeScript SDK receives protocol updates first. Monorepo coherence (shared types, shared Zod schemas) outweighs Python's ML advantages at the protocol layer.

## ADR-002 — Python for NL Assembly and Semantic Diff only

Python is used exclusively for services requiring ML inference (sentence-transformers) or AST parsing (tree-sitter). Everything else is TypeScript. Do not introduce Python in other services.

## ADR-003 — Drizzle ORM over Prisma

Drizzle has native pgvector support (vector column types, HNSW indexes, cosine distance functions). Prisma requires raw SQL for pgvector. Since pgvector is central to NL Assembly search, Drizzle is the correct choice.

## ADR-004 — Hono over Express/Fastify for the Hooks Bridge

Hono is TypeScript-native, has `app.request()` for testing without a running server, and produces minimal bundles. The Hooks Bridge is latency-sensitive (`PreToolUse` must respond in <200ms) — Hono's low overhead matters.

## ADR-005 — Vitest over Jest

Vitest is 5.6x faster cold start in monorepo benchmarks. Native TypeScript/ESM support eliminates Babel/ts-jest config. Jest-compatible API means near-zero learning curve.

## ADR-006 — BullMQ for job queues

Embedding generation and semantic diff are async, CPU-bound tasks. BullMQ provides rate limiting (critical for LLM API calls), job flows, retries with backoff, and a dashboard. Redis is already in the stack.

## ADR-007 — Append-only event store for Context Packs

Context Packs and Run Events are immutable — they are historical records. The append-only constraint prevents accidental data loss and enables event sourcing. Implemented via PostgreSQL with no UPDATE/DELETE permissions on these tables.

## ADR-008 — Local-first SQLite as primary store

The VS Code extension uses SQLite (`better-sqlite3` + `sqlite-vec`) as the **primary store**, not a cache. Runs, run events, and context packs are written locally first. Cloud PostgreSQL is the team-sync layer — optional for individual developer use. This eliminates the #1 enterprise blocker (data leaving dev machines) and guarantees sub-millisecond reads with zero network dependency.

## ADR-009 — Cursor hook adapter

Cursor hooks are command-based (stdin/stdout JSON) while Claude Code supports HTTP hooks. ContextOS uses a single adapter script (`.cursor/hooks/contextos.sh`) that reads Cursor's JSON from stdin, normalizes field names (e.g., `conversation_id` → `session_id`), POSTs to the hooks-bridge, and translates the response back to Cursor's stdout format. Same semantics, different transport. See `system-architecture.md` §15 for full adapter specification.

## ADR-010 — Graphify import for cold-start

Graphify (`safishamsi/graphify`, MIT license) produces a `graph.json` with tree-sitter AST nodes clustered by Leiden community detection. ContextOS imports this output to seed initial Feature Pack content — each community becomes a Feature Pack section. Solves the cold-start problem (first session runs without context) without requiring manual Feature Pack authoring.

## ADR-011 — Policy Engine as Non-Human Identity (NHI) infrastructure

The policy engine treats AI coding agents as distinct non-human identities. Policy rules include an `agent_type` field (`claude_code`, `cursor`, `copilot`, `*`) enabling per-agent permission scoping. Combined with the `policy_decisions` audit table, this positions ContextOS as enterprise access governance for AI agents — not just a context injection tool.
