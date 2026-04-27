/**
 * `packages/cli/src/lib/log-destination-shim` — must be imported first
 * in the CLI binary's entry point, before any module that constructs
 * a `@contextos/shared` logger (`createLogger` reads the env var at
 * module-init time).
 *
 * Closes integration finding 2026-04-27 (post-08a walk): `contextos init`
 * was printing structured pino JSON onto stdout, interleaved with the
 * human-readable `✓`/`⚠` progress UI. Scripted callers piping init or
 * doctor output got JSON garbage mixed with checkmarks. Root cause:
 * the shared logger defaults to pino's stdout when no destination is
 * configured; mcp-server's stdio transport sets `CONTEXTOS_LOG_DESTINATION=stderr`
 * via .mcp.json, but the CLI binary had no equivalent hook.
 *
 * Defaulting to stderr in the CLI binary keeps stdout JSON-clean for
 * scripted consumers while preserving any explicit user override
 * (`CONTEXTOS_LOG_DESTINATION=stdout contextos doctor` still works
 * for users who want both streams unified).
 *
 * Why a separate file: ESM evaluates imports in source order. A
 * top-level statement `process.env.CONTEXTOS_LOG_DESTINATION = 'stderr'`
 * placed AFTER `import { buildProgram } from './program.js'` would run
 * after every transitively-imported `createLogger` call has already
 * captured the original (undefined) value. Keeping the assignment in
 * its own module that index.ts imports first is the only ordering-safe
 * way.
 */

if (process.env.CONTEXTOS_LOG_DESTINATION === undefined) {
  process.env.CONTEXTOS_LOG_DESTINATION = 'stderr';
}
