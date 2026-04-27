/**
 * Common daemon-manager interface — every platform implementation
 * (launchd / systemd / Task Scheduler / fallback) implements this contract.
 * Per spec §4 + techstack.md "Process management — daemon manager strategy".
 */

export interface DaemonUnit {
  /** Stable unit name; doubles as the PID-file basename for the fallback. */
  readonly name: string;
  /** Absolute path to the binary or interpreter. */
  readonly command: string;
  /** Command-line args. */
  readonly args: readonly string[];
  /** Env vars to set at unit launch. */
  readonly env: Readonly<Record<string, string>>;
  /** Optional working directory. */
  readonly workingDir?: string;
  /**
   * Absolute path for stderr capture. Each manager wires it to its native
   * mechanism (launchd `StandardErrorPath`, systemd `StandardError=append:<path>`,
   * fallback redirects the detached child's stderr). When omitted, stderr
   * goes to the manager's default sink (often /dev/null on macOS launchd —
   * use this option in production so doctor check 8's F15 spot-check has
   * something to read).
   */
  readonly stderrPath?: string;
  /** Absolute path for stdout capture. Same semantics as `stderrPath`. */
  readonly stdoutPath?: string;
}

export interface DaemonStatus {
  readonly name: string;
  readonly state: 'running' | 'stopped' | 'unknown';
  /** Process ID when running and known. */
  readonly pid?: number;
  /** Manager-specific extra detail (e.g. launchctl loadStatus). */
  readonly detail?: string;
}

export interface DaemonManager {
  /** Manager-readable label for logs / status output. */
  readonly kind: 'launchd' | 'systemd' | 'task-scheduler' | 'fallback';
  /** Probe the manager's underlying CLI; returns false when unreachable. */
  isAvailable(): Promise<boolean>;
  /** Install the unit — creates the plist/service file/PID-track entry. */
  install(unit: DaemonUnit): Promise<void>;
  /** Remove the unit — the inverse of install(). Idempotent. */
  uninstall(unitName: string): Promise<void>;
  /** Start the unit. Idempotent — already-running units no-op. */
  start(unitName: string): Promise<void>;
  /** Stop the unit. Idempotent — already-stopped units no-op. */
  stop(unitName: string): Promise<void>;
  /** Return the current state for a single unit. */
  status(unitName: string): Promise<DaemonStatus>;
  /** Return all units this manager knows about. */
  list(): Promise<DaemonStatus[]>;
}
