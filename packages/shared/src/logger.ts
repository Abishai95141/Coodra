import { type Logger, type LoggerOptions, pino } from 'pino';

/**
 * Structured JSON logger for ContextOS services.
 *
 * Contract (`essentialsforclaude/01-development-discipline.md` §1.5):
 * every log line carries a correlation id (runId / sessionId), an operation
 * name, and the relevant entity ids. Use `createLogger(name, context)` to
 * bind a service/module name at startup and attach short-lived context
 * via `logger.child({ runId, ... })` at call sites.
 *
 * In development, pipe the process output through `pino-pretty`:
 *   `pnpm --filter @contextos/<service> dev | pnpm exec pino-pretty`.
 * We deliberately do not wire `pino-pretty` as a runtime transport: the
 * transport worker thread is a dev-time ergonomic, not a production
 * dependency, and reaching for it silently in production would hide
 * the source of any formatting bug.
 */

type PinoLevel = NonNullable<LoggerOptions['level']>;

const DEFAULT_LEVEL: PinoLevel = 'info';

function resolveLevel(envLevel: string | undefined): PinoLevel {
  const normalized = envLevel?.toLowerCase();
  const allowed: readonly PinoLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
  if (normalized !== undefined && (allowed as readonly string[]).includes(normalized)) {
    return normalized as PinoLevel;
  }
  return DEFAULT_LEVEL;
}

const baseOptions: LoggerOptions = {
  level: resolveLevel(process.env.LOG_LEVEL),
  base: {
    pid: process.pid,
    host: process.env.HOSTNAME ?? 'local',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

export const logger: Logger = pino(baseOptions);

/**
 * Returns a child logger bound to a service/module name and optional
 * long-lived context. Call sites should further bind per-request context
 * via `created.child({ runId, projectId })`.
 */
export function createLogger(name: string, context?: Readonly<Record<string, unknown>>): Logger {
  if (!name || typeof name !== 'string') {
    throw new TypeError('createLogger: name must be a non-empty string');
  }
  return logger.child({ name, ...(context ?? {}) });
}

export type { Logger, LoggerOptions };
