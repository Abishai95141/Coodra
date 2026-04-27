/**
 * Severity tier per spec §4.5. Each check declares the maximum severity it
 * can emit; the runner records the actual outcome as a `CheckStatus`. Reds
 * map to fix-required-now; yellows to operational warnings; greens to clean.
 */
export type CheckSeverity = 'red' | 'yellow' | 'green-or-yellow' | 'permanent-yellow';

export type CheckStatus = 'green' | 'yellow' | 'red' | 'skipped' | 'timeout';

export interface CheckResult {
  readonly status: CheckStatus;
  readonly detail?: string;
  readonly remediation?: string;
}

export interface CheckContext {
  /** Resolved `~/.contextos/` per spec §11 Decision 2. */
  readonly contextosHome: string;
  /** Path to `<contextosHome>/data.db`. */
  readonly dataDb: string;
  /** Resolved cwd (project root candidate). */
  readonly cwd: string;
  /** Captured env so the runner is testable without mutating process.env. */
  readonly env: NodeJS.ProcessEnv;
  /** MCP server port (from env or 3100 default). */
  readonly mcpPort: number;
  /** Hooks bridge port (from env or 3101 default). */
  readonly bridgePort: number;
  /** Stable clock for tests. */
  readonly now: () => Date;
  /** Per-check timeout in ms (set by `--timeout-ms`, default 2000). */
  readonly timeoutMs: number;
  /** Platform (defaults to process.platform). Tests override. */
  readonly platform: NodeJS.Platform;
  /** Node version (defaults to process.versions.node). Tests override. */
  readonly nodeVersion: string;
}

export interface Check {
  readonly id: number;
  readonly name: string;
  readonly severity: CheckSeverity;
  /** Run the check; must always resolve (use `try/catch` internally). */
  run(context: CheckContext): Promise<CheckResult>;
}

export interface CheckRunResult {
  readonly id: number;
  readonly name: string;
  readonly severity: CheckSeverity;
  readonly status: CheckStatus;
  readonly detail?: string;
  readonly remediation?: string;
  /** Wall-clock ms the check took. */
  readonly durationMs: number;
}

export interface DoctorReport {
  readonly version: string;
  readonly contextosHome: string;
  readonly cwd: string;
  readonly checks: readonly CheckRunResult[];
  readonly summary: {
    readonly ok: number;
    readonly warn: number;
    readonly fail: number;
    readonly skipped: number;
  };
}
