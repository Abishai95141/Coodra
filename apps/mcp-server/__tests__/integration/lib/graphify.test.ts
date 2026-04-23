import { describe, expect, it } from 'vitest';

import { NotImplementedError } from '../../../src/lib/errors.js';
import { createGraphifyClient } from '../../../src/lib/graphify.js';

/**
 * Integration test for `src/lib/graphify.ts`.
 *
 * S7a stub. Locks the user-directive "domain-shaped API" constraint:
 * `expandContext({ runId, depth })` is the only method exposed today.
 * Module 05 adds the wider graph surface; S15's
 * `query_codebase_graph` is the first tool to consume this client.
 */

describe('lib/graphify — createGraphifyClient', () => {
  it('constructs with no deps (default graphify root)', () => {
    const client = createGraphifyClient();
    expect(typeof client.expandContext).toBe('function');
  });

  it('constructs with an explicit graphifyRoot', () => {
    const client = createGraphifyClient({ graphifyRoot: '/tmp/graphify' });
    expect(typeof client.expandContext).toBe('function');
  });

  it('exposes only domain methods (no raw SQL / file ops)', () => {
    const client = createGraphifyClient() as unknown as Record<string, unknown>;
    expect(typeof client.expandContext).toBe('function');
    expect(client.run).toBeUndefined();
    expect(client.query).toBeUndefined();
    expect(client.readFile).toBeUndefined();
  });

  it('expandContext throws NotImplementedError until S7c', async () => {
    const client = createGraphifyClient();
    await expect(client.expandContext({ runId: 'run_abc', depth: 1 })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
