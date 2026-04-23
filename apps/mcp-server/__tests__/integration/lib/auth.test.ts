import { UnauthorizedError } from '@contextos/shared';
import { describe, expect, it } from 'vitest';

import { createAnonymousAuthClient, createSoloAuthClient, SOLO_IDENTITY } from '../../../src/lib/auth.js';

/**
 * Integration test for `src/lib/auth.ts`.
 *
 * Proves that both factory outputs satisfy the shared `AuthClient`
 * interface and that `requireIdentity` enforces its contract — the
 * solo factory resolves, the anonymous factory rejects with
 * `UnauthorizedError` from `@contextos/shared`.
 *
 * This locks the S7a invariant that tool code never branches on
 * "is this solo or Clerk?" — both paths respond to the same
 * interface and differ only in the identity they return (or the
 * error they throw).
 */

describe('lib/auth — createSoloAuthClient', () => {
  it('returns the frozen SOLO_IDENTITY from getIdentity', async () => {
    const auth = createSoloAuthClient();
    const id = await auth.getIdentity();
    expect(id).toEqual(SOLO_IDENTITY);
  });

  it('returns the frozen SOLO_IDENTITY from requireIdentity (no throw)', async () => {
    const auth = createSoloAuthClient();
    await expect(auth.requireIdentity()).resolves.toEqual(SOLO_IDENTITY);
  });

  it('SOLO_IDENTITY has source="solo-bypass" for audit', () => {
    expect(SOLO_IDENTITY.source).toBe('solo-bypass');
    expect(SOLO_IDENTITY.userId).toBe('user_dev_local');
    expect(SOLO_IDENTITY.orgId).toBe('org_dev_local');
  });
});

describe('lib/auth — createAnonymousAuthClient', () => {
  it('returns null from getIdentity', async () => {
    const auth = createAnonymousAuthClient();
    await expect(auth.getIdentity()).resolves.toBeNull();
  });

  it('throws UnauthorizedError from requireIdentity', async () => {
    const auth = createAnonymousAuthClient();
    await expect(auth.requireIdentity()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
