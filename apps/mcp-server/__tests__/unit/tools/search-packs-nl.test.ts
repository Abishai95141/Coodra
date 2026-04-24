import type { DbHandle } from '@contextos/db';
import { EMBEDDING_DIM } from '@contextos/shared';
import { assertManifestDescriptionValid } from '@contextos/shared/test-utils';
import { describe, expect, it } from 'vitest';

import { createSearchPacksNlToolRegistration } from '../../../src/tools/search-packs-nl/manifest.js';
import { searchPacksNlInputSchema } from '../../../src/tools/search-packs-nl/schema.js';

/**
 * Unit tests for `contextos__search_packs_nl` — manifest contract +
 * input schema boundaries + idempotency-key shape. DB behaviour
 * (projects resolve, semantic KNN, LIKE fallback) is in the
 * integration suite.
 */

const fakeDb = { kind: 'sqlite', db: {}, raw: {}, close: () => {} } as unknown as DbHandle;

describe('search_packs_nl — manifest contract', () => {
  it('satisfies every §24.3 rule via assertManifestDescriptionValid', () => {
    const reg = createSearchPacksNlToolRegistration({ db: fakeDb });
    expect(() => assertManifestDescriptionValid(reg, { folderName: 'search-packs-nl' })).not.toThrow();
  });

  it('name is exactly "search_packs_nl"', () => {
    const reg = createSearchPacksNlToolRegistration({ db: fakeDb });
    expect(reg.name).toBe('search_packs_nl');
  });
});

describe('search_packs_nl — idempotency-key shape', () => {
  it('is readonly + encodes projectSlug + embedding-presence + query prefix', () => {
    const reg = createSearchPacksNlToolRegistration({ db: fakeDb });
    const keyWithEmbed = reg.idempotencyKey(
      { projectSlug: 'proj-a', query: 'find foo', embedding: [0.1, 0.2] },
      { sessionId: 'sess_1', receivedAt: new Date(0) },
    );
    expect(keyWithEmbed.kind).toBe('readonly');
    expect(keyWithEmbed.key).toBe('readonly:search_packs_nl:proj-a:e1:find foo');

    const keyNoEmbed = reg.idempotencyKey(
      { projectSlug: 'proj-a', query: 'find foo' },
      { sessionId: 'sess_1', receivedAt: new Date(0) },
    );
    expect(keyNoEmbed.key).toBe('readonly:search_packs_nl:proj-a:e0:find foo');
  });

  it('truncates to 200 chars', () => {
    const reg = createSearchPacksNlToolRegistration({ db: fakeDb });
    const key = reg.idempotencyKey(
      { projectSlug: 'x'.repeat(128), query: 'y'.repeat(500) },
      { sessionId: 'sess', receivedAt: new Date(0) },
    );
    expect(key.key.length).toBeLessThanOrEqual(200);
  });
});

describe('search_packs_nl — input schema boundaries', () => {
  it('accepts a minimal valid payload (query only)', () => {
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: 'p', query: 'find it' }).success).toBe(true);
  });

  it('accepts a valid embedding array of any length (dim check is handler-level)', () => {
    const tooShort = searchPacksNlInputSchema.safeParse({
      projectSlug: 'p',
      query: 'find',
      embedding: [0.1, 0.2, 0.3],
    });
    expect(tooShort.success).toBe(true); // Zod does NOT reject — handler produces soft-failure.
  });

  it('accepts a valid 384-dim embedding', () => {
    const embedding = new Array(EMBEDDING_DIM).fill(0);
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: 'p', query: 'find', embedding }).success).toBe(true);
  });

  it('rejects empty query', () => {
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: 'p', query: '' }).success).toBe(false);
  });

  it('rejects empty projectSlug', () => {
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: '', query: 'x' }).success).toBe(false);
  });

  it('rejects query > 4096 chars', () => {
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: 'p', query: 'x'.repeat(4097) }).success).toBe(false);
  });

  it('rejects limit < 1', () => {
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: 'p', query: 'x', limit: 0 }).success).toBe(false);
  });

  it('rejects limit > 200', () => {
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: 'p', query: 'x', limit: 201 }).success).toBe(false);
  });

  it('rejects unknown fields (strict)', () => {
    expect(searchPacksNlInputSchema.safeParse({ projectSlug: 'p', query: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('search_packs_nl — factory construction contract', () => {
  it('rejects missing options', () => {
    // biome-ignore lint/suspicious/noExplicitAny: negative test
    expect(() => createSearchPacksNlToolRegistration(undefined as unknown as any)).toThrow(TypeError);
  });

  it('rejects non-DbHandle db', () => {
    // biome-ignore lint/suspicious/noExplicitAny: negative test
    expect(() => createSearchPacksNlToolRegistration({ db: {} as any })).toThrow(/db must be a DbHandle/);
  });
});
