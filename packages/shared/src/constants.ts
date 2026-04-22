/**
 * Cross-package constants that must be locked to a single source of truth.
 *
 * Every consumer of embedding storage (SQLite vec0 virtual table, Postgres
 * `vector(...)` column, `packages/db` schema, `services/nl-assembly`
 * encoder, Module 05 batch jobs) reads `EMBEDDING_DIM` from here. Changing
 * the dimension requires:
 *   1. Update this constant.
 *   2. Regenerate migrations (SQLite vec0 DDL in the hand-written block,
 *      Postgres `vector(N)` column).
 *   3. Re-hash `migrations.lock.json`.
 *   4. Rebuild or re-embed every row in `context_packs.summary_embedding`.
 *   5. Update `system-architecture.md §5` if the model family changes.
 *
 * 384 matches `sentence-transformers/all-MiniLM-L6-v2` (the default
 * encoder per `system-architecture.md §5`). `nomic-embed-text-v1.5` (768)
 * would require migration; see point 4 above.
 */
export const EMBEDDING_DIM = 384 as const;
export type EmbeddingDim = typeof EMBEDDING_DIM;
