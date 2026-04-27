// Stable exit-code contract per `docs/feature-packs/08a-cli/techstack.md` §"Process exit codes".
// These codes MUST be stable across versions — shell scripts on user machines depend on them.
// Adding a new code is non-breaking; reusing or removing a code is a major version bump.
export const EXIT_OK = 0;
export const EXIT_USER_RECOVERABLE = 1;
export const EXIT_USER_ACTION_REQUIRED = 2;
export const EXIT_ENVIRONMENT_PROBLEM = 3;
export const EXIT_SERVICE_STARTUP_FAILED = 4;
export const EXIT_UNIMPLEMENTED = 99;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_USER_RECOVERABLE
  | typeof EXIT_USER_ACTION_REQUIRED
  | typeof EXIT_ENVIRONMENT_PROBLEM
  | typeof EXIT_SERVICE_STARTUP_FAILED
  | typeof EXIT_UNIMPLEMENTED;
