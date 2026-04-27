import pc from 'picocolors';
import { buildCheckContext } from '../doctor/context.js';
import { formatHuman, formatJson } from '../doctor/output.js';
import { ALL_CHECKS } from '../doctor/registry.js';
import { exitCodeForReport, runChecks } from '../doctor/run.js';

export interface DoctorOptions {
  readonly json?: boolean;
  readonly timeoutMs?: string;
}

export interface DoctorIO {
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
  readonly exit: (code: number) => never;
}

export const DEFAULT_DOCTOR_IO: DoctorIO = {
  writeStdout: (chunk) => {
    process.stdout.write(chunk);
  },
  writeStderr: (chunk) => {
    process.stderr.write(chunk);
  },
  exit: (code) => {
    process.exit(code);
  },
};

export async function runDoctorCommand(options: DoctorOptions = {}, io: DoctorIO = DEFAULT_DOCTOR_IO): Promise<never> {
  const timeoutMs = parseTimeout(options.timeoutMs);
  const ctx = buildCheckContext({ timeoutMs });
  const report = await runChecks(ALL_CHECKS, ctx);
  const exit = exitCodeForReport(report);

  if (options.json === true) {
    io.writeStdout(`${formatJson(report)}\n`);
  } else {
    io.writeStdout(`${formatHuman(report)}\n`);
    if (exit === 2) {
      io.writeStderr(`${pc.red('doctor: red findings present — fix the items above before continuing.')}\n`);
    }
  }
  return io.exit(exit);
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined) return 2000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2000;
  return parsed;
}
