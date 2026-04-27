import pc from 'picocolors';
import type { CheckRunResult, CheckStatus, DoctorReport } from './types.js';

const STATUS_GLYPH: Record<CheckStatus, string> = {
  green: '✓',
  yellow: '⚠',
  red: '✗',
  timeout: '⏱',
  skipped: '·',
};

const STATUS_COLOR: Record<CheckStatus, (s: string) => string> = {
  green: pc.green,
  yellow: pc.yellow,
  red: pc.red,
  timeout: pc.red,
  skipped: pc.gray,
};

export function formatHuman(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`contextos doctor — @contextos/cli ${report.version}`);
  lines.push(`  contextosHome: ${report.contextosHome}`);
  lines.push(`  cwd: ${report.cwd}`);
  lines.push('');

  for (const check of report.checks) {
    lines.push(formatCheckLine(check));
    if (check.detail !== undefined && check.status !== 'green') {
      lines.push(pc.gray(`     ↳ ${check.detail}`));
    }
    if (check.remediation !== undefined && check.status !== 'green') {
      lines.push(pc.gray(`     ↳ fix: ${check.remediation}`));
    }
  }

  lines.push('');
  lines.push(
    `Summary: ${pc.green(`${report.summary.ok} ok`)} · ` +
      `${pc.yellow(`${report.summary.warn} warn`)} · ` +
      `${pc.red(`${report.summary.fail} fail`)} · ` +
      `${pc.gray(`${report.summary.skipped} skipped`)}`,
  );
  return lines.join('\n');
}

function formatCheckLine(check: CheckRunResult): string {
  const colorize = STATUS_COLOR[check.status];
  const glyph = colorize(STATUS_GLYPH[check.status]);
  const id = String(check.id).padStart(2, ' ');
  return `${glyph}  ${id}. ${check.name}`;
}

export function formatJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
