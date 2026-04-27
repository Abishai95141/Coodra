import type { Check } from '../types.js';

/**
 * PERMANENT YELLOW until Module 03.1 (Durable Audit Outbox) lands.
 * The check exists so M03.1's landing flips the entry to green automatically
 * (when the placeholder feature pack is replaced with the real implementation).
 *
 * See `docs/feature-packs/03.1-durable-outbox/spec.md` and the M03 closeout's
 * "Post-merge integration findings" section for what's at stake.
 */
export const auditDurabilityCheck: Check = {
  id: 13,
  name: 'Audit-write durability (Module 03.1 — DURABLE OUTBOX placeholder)',
  severity: 'permanent-yellow',
  async run() {
    return {
      status: 'yellow',
      detail: 'Audit writes are still `setImmediate`-based; SIGTERM mid-PreToolUse can lose a row.',
      remediation:
        'Module 03.1 (Durable Audit Outbox) is on the roadmap before Module 04. ' +
        'See `docs/feature-packs/03.1-durable-outbox/spec.md`.',
    };
  },
};
