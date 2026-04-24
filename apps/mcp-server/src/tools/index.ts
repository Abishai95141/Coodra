import type { DbHandle } from '@contextos/db';

import type { ToolRegistry } from '../framework/tool-registry.js';
import { getFeaturePackToolRegistration } from './get-feature-pack/manifest.js';
import { createGetRunIdToolRegistration } from './get-run-id/manifest.js';
import { pingToolRegistration } from './ping/manifest.js';
import { createSaveContextPackToolRegistration } from './save-context-pack/manifest.js';

/**
 * `apps/mcp-server/src/tools/index.ts` — registration barrel.
 *
 * Every tool under `src/tools/<name>/` is registered here. The guard
 * test `__tests__/unit/tools/_no-unregistered-tools.test.ts` walks
 * the `src/tools` directory and asserts each folder has a
 * corresponding registration — the failure mode named in
 * `essentialsforclaude/10-troubleshooting.md` ("tools/list returns
 * empty because a manifest was not wired in") becomes a CI error
 * rather than a runtime surprise.
 *
 * Tools whose handlers need process-level config (e.g. `get_run_id`
 * needs the DB handle and `CONTEXTOS_MODE`) are exported from their
 * `manifest.ts` as `createXxxToolRegistration(deps)` factories; this
 * barrel is the single place those factories are called.
 *
 * Tools whose handlers are pure (e.g. `ping`) export a static
 * `xxxToolRegistration` constant that is registered directly.
 */

export interface RegisterAllToolsDeps {
  readonly db: DbHandle;
  readonly mode: 'solo' | 'team';
}

export function registerAllTools(registry: ToolRegistry, deps: RegisterAllToolsDeps): void {
  registry.register(pingToolRegistration);
  registry.register(createGetRunIdToolRegistration({ db: deps.db, mode: deps.mode }));
  registry.register(getFeaturePackToolRegistration);
  registry.register(createSaveContextPackToolRegistration({ db: deps.db }));
}
