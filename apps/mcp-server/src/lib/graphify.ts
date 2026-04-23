import type { Logger } from '@contextos/shared';

import type { GraphifyClient } from '../framework/tool-context.js';
import { NotImplementedError } from './errors.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/graphify.ts` — factory for the graphify
 * client wired into `ToolContext.graphify`.
 *
 * User constraint (S7a): domain-shaped API, not a query executor.
 * Module 05 ships the complete graph surface; Module 02 only needs
 * `expandContext({ runId, depth })` for S15's `query_codebase_
 * graph` tool, so that is the only method the interface exposes
 * today. New domain methods (e.g. `findSymbolNeighbours`,
 * `communitiesContaining`) slot in here in later modules.
 *
 * Missing-graph fallback (plan §S15): when `~/.contextos/graphify/
 * <slug>/graph.json` is absent, the real (S7c) impl returns an
 * empty subgraph plus a `notice: 'graphify_index_missing'` so the
 * tool handler can surface the documented `howToFix: 'run `graphify
 * scan` at repo root'`. That contract lives in the tool handler,
 * not here — this client purely returns `{ nodes: [], edges: [] }`
 * with a separate mechanism for the notice (method on the client in
 * S7c; left out of the S7a interface until the handler is written).
 *
 * S7a method throws `NotImplementedError('graphify.expandContext')`.
 */

const graphifyLogger = createMcpLogger('lib-graphify');

export interface CreateGraphifyClientDeps {
  /** Root for `graph.json` lookups. Defaults to `~/.contextos/graphify` in S7c. */
  readonly graphifyRoot?: string;
  readonly logger?: Logger;
}

export function createGraphifyClient(deps: CreateGraphifyClientDeps = {}): GraphifyClient {
  const log = deps.logger ?? graphifyLogger;
  log.debug(
    { event: 'graphify_client_created', graphifyRoot: deps.graphifyRoot ?? '<default>' },
    'graphify client stub created (S7c will land the real impl)',
  );

  return {
    async expandContext(_args) {
      throw new NotImplementedError('graphify.expandContext');
    },
  };
}
