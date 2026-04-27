import { access } from 'node:fs/promises';
import { openLocalDb } from '../../lib/open-local-db.js';
import type { Check } from '../types.js';

// F14 lock — `pd:{sessionId}:{toolUseId}:{toolName}:{eventType}`. Pre-F14 rows
// have only 3 segments after the `pd:` prefix; this regex demands 4.
const F14_KEY_PATTERN = /^pd:[^:]+:[^:]+:[^:]+:.+$/;

export const policyKeyShapeCheck: Check = {
  id: 6,
  name: 'policy_decisions idempotency_key shape (F14 — 4 segments)',
  severity: 'yellow',
  async run(ctx) {
    try {
      await access(ctx.dataDb);
    } catch {
      return { status: 'skipped', detail: 'data.db missing' };
    }
    let handle: Awaited<ReturnType<typeof openLocalDb>>;
    try {
      handle = await openLocalDb(ctx.dataDb);
    } catch {
      return { status: 'skipped', detail: 'cannot open data.db' };
    }
    try {
      const rows = handle.raw
        .prepare(`SELECT idempotency_key FROM policy_decisions ORDER BY created_at DESC LIMIT 100`)
        .all() as Array<{ idempotency_key: string }>;
      if (rows.length === 0) {
        return { status: 'green', detail: 'no policy_decisions rows yet (nothing to validate)' };
      }
      const legacy = rows.filter((r) => !F14_KEY_PATTERN.test(r.idempotency_key));
      if (legacy.length === 0) {
        return { status: 'green', detail: `${rows.length} recent rows match F14 4-segment shape` };
      }
      return {
        status: 'yellow',
        detail: `${legacy.length}/${rows.length} recent rows are pre-F14 (3-segment) shape`,
        remediation:
          'Pre-F14 rows are auditable but missing toolUseId. Future writes are F14-compliant; ' +
          'no migration required unless audit reports flag the pre-F14 records.',
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('no such table')) {
        return { status: 'skipped', detail: 'policy_decisions table missing — migrations not applied' };
      }
      return { status: 'red', detail: msg, remediation: 'Inspect data.db schema.' };
    } finally {
      try {
        handle.close();
      } catch {
        // ignore
      }
    }
  },
};
