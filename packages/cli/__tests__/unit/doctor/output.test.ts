import { describe, expect, it } from 'vitest';
import { formatHuman, formatJson } from '../../../src/doctor/output.js';
import type { DoctorReport } from '../../../src/doctor/types.js';

const sampleReport: DoctorReport = {
  version: '0.0.0-test',
  contextosHome: '/tmp/contextos',
  cwd: '/tmp/work/myapp',
  checks: [
    { id: 1, name: 'Node', severity: 'red', status: 'green', durationMs: 5 },
    {
      id: 2,
      name: 'Bridge',
      severity: 'yellow',
      status: 'yellow',
      detail: 'down',
      remediation: 'start it',
      durationMs: 12,
    },
    { id: 3, name: 'Mig', severity: 'red', status: 'red', detail: 'behind', remediation: 'init', durationMs: 8 },
  ],
  summary: { ok: 1, warn: 1, fail: 1, skipped: 0 },
};

describe('formatHuman', () => {
  it('includes header, per-check lines, remediations, and summary', () => {
    const out = formatHuman(sampleReport);
    expect(out).toContain('@contextos/cli 0.0.0-test');
    expect(out).toContain('/tmp/contextos');
    expect(out).toContain('1. Node');
    expect(out).toContain('2. Bridge');
    expect(out).toContain('start it');
    expect(out).toContain('Summary');
  });
});

describe('formatJson', () => {
  it('emits a structured object that round-trips JSON.parse', () => {
    const json = formatJson(sampleReport);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe('0.0.0-test');
    expect(parsed.checks).toHaveLength(3);
    expect(parsed.summary.fail).toBe(1);
  });
});
