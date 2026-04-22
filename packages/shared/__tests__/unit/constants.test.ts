import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIM } from '../../src/constants.js';

/**
 * Locks the `EMBEDDING_DIM` value. Any change must be a deliberate edit
 * to both this assertion and every downstream consumer (sqlite-vec
 * virtual-table DDL, Postgres `vector(N)` column, NL Assembly encoder
 * choice). See `packages/shared/src/constants.ts` for the full change
 * checklist.
 */
describe('EMBEDDING_DIM', () => {
  it('is 384 (sentence-transformers/all-MiniLM-L6-v2)', () => {
    expect(EMBEDDING_DIM).toBe(384);
  });

  it('is typed as the literal 384 (compile-time lock)', () => {
    // Assigning to a `384`-typed slot fails compilation if the constant
    // drifts, catching regressions at typecheck rather than at runtime.
    const pinned: 384 = EMBEDDING_DIM;
    expect(pinned).toBe(384);
  });
});
