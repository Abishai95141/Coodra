import { type BaseEnv, baseEnvSchema, parseEnv } from '@contextos/shared';
import { z } from 'zod';

/**
 * The one and only place in `@contextos/mcp-server` that reads
 * `process.env`. Every other module depends on the typed `env`
 * singleton exported at the bottom of this file. Any direct
 * `process.env.X` reference outside this file is a lint-level bug
 * (caught in review; see `README.md` "Critical invariants").
 *
 * Contract:
 *   1. Parse is **synchronous** and happens at module load. A broken
 *      env file means the process fails at boot rather than mid-
 *      request when the bad var is first read.
 *   2. The result is a fully-typed object. No `string | undefined`
 *      leaks out; every variable is either required (and validated)
 *      or has a defaulted non-undefined value.
 *   3. Failure is a `ValidationError` from `@contextos/shared` —
 *      same error class the db layer uses — carrying the specific
 *      Zod path so operators can find the offending variable.
 *   4. Mode-conditional rules (Clerk keys required in team mode)
 *      are enforced with `.superRefine`. The rules follow addition C
 *      of the Module 02 plan and are locked by the regression test
 *      in S7a (Module 02 implementation plan).
 *
 * S5 scope note: only CONTEXTOS_MODE, LOG_LEVEL, HOSTNAME, and
 * CONTEXTOS_LOG_DESTINATION are actually CONSUMED in S5 (stdio
 * transport, no auth). The rest of the schema is defined now so that
 * S6+ slices can rely on a single, versioned `env` shape from day one.
 * Defining all variables up-front is deliberate: it moves shape
 * changes to the schema file (one diff), not to every consumer that
 * grows a new `process.env` read.
 */

const SOLO_BYPASS_CLERK_SENTINEL = 'sk_test_replace_me' as const;

const mcpServerEnvSchema = baseEnvSchema
  .extend({
    /** stdio transport requires stderr (bootstrap enforces this). */
    CONTEXTOS_LOG_DESTINATION: z
      .enum(['stdout', 'stderr'])
      .default('stderr')
      .describe(
        "Where pino writes log lines. 'stderr' is required under the stdio MCP transport; 'stdout' is allowed for future HTTP-only deployments.",
      ),

    /**
     * HTTP transport port. Consumed by S16 (HTTP transport). Parsed
     * eagerly so mis-typed values fail at boot, not at S16 wire-up.
     */
    MCP_SERVER_PORT: z.coerce
      .number()
      .int()
      .positive()
      .max(65535)
      .default(3100)
      .describe('TCP port for the Streamable HTTP transport, loopback-bound in solo mode.'),

    /**
     * Shared secret that the local PostToolUse hook client uses to
     * authenticate itself to the HTTP transport. Consumed by S7b.
     */
    LOCAL_HOOK_SECRET: z
      .string()
      .min(16, 'LOCAL_HOOK_SECRET must be at least 16 characters if set')
      .optional()
      .describe('Shared secret for the PostToolUse hook → HTTP transport path.'),

    /**
     * Clerk publishable key. Format validated here; mode-conditional
     * required-ness below.
     */
    CLERK_PUBLISHABLE_KEY: z
      .string()
      .regex(/^pk_(test|live)_/, "CLERK_PUBLISHABLE_KEY must start with 'pk_test_' or 'pk_live_'")
      .optional()
      .describe('Clerk publishable (frontend) key. Required in team mode unless the solo-bypass sentinel is set.'),

    /**
     * Clerk secret key. Format validated here; mode-conditional
     * required-ness below. The literal 'sk_test_replace_me' is the
     * solo-bypass sentinel and is allowed in any mode.
     */
    CLERK_SECRET_KEY: z
      .string()
      .refine(
        (v) => v === SOLO_BYPASS_CLERK_SENTINEL || /^sk_(test|live)_/.test(v),
        "CLERK_SECRET_KEY must start with 'sk_test_' or 'sk_live_' (or be the solo-bypass sentinel 'sk_test_replace_me')",
      )
      .optional()
      .describe('Clerk secret (backend) key. Required in team mode unless the solo-bypass sentinel is set.'),

    /**
     * Clerk JWT issuer URL, used by `@clerk/backend`'s
     * `authenticateRequest()` in S7b. Optional in S5.
     */
    CLERK_JWT_ISSUER: z
      .string()
      .url()
      .optional()
      .describe("Clerk tenant JWT issuer URL (e.g. 'https://clerk.<tenant>.dev')."),
  })
  .superRefine((env, ctx) => {
    // Addition C of the Module 02 plan: team mode with a non-sentinel
    // secret requires BOTH Clerk keys to be present, otherwise the
    // server would silently run as solo-bypass in production — the
    // hardest-to-detect auth failure mode.
    if (env.CONTEXTOS_MODE === 'team' && env.CLERK_SECRET_KEY !== SOLO_BYPASS_CLERK_SENTINEL) {
      if (!env.CLERK_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLERK_SECRET_KEY'],
          message:
            'team mode requires CLERK_SECRET_KEY (set it to a real sk_test_/sk_live_ key, or use the solo-bypass sentinel sk_test_replace_me for local dev only)',
        });
      }
      if (!env.CLERK_PUBLISHABLE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLERK_PUBLISHABLE_KEY'],
          message: 'team mode requires CLERK_PUBLISHABLE_KEY (pk_test_/pk_live_) when CLERK_SECRET_KEY is set',
        });
      }
    }
  });

export type McpServerEnv = z.infer<typeof mcpServerEnvSchema> & BaseEnv;

/**
 * Typed env singleton. Parsed exactly once, at first import, via
 * @contextos/shared's `parseEnv` so the ValidationError shape is
 * identical to every other service's startup failure.
 */
export const env: McpServerEnv = parseEnv(mcpServerEnvSchema) as McpServerEnv;

/**
 * Exposed for unit tests only — they reload the module under different
 * fixtures and need access to the raw schema. Not part of the public
 * API; consumers import `env` above.
 */
export const __internal = {
  schema: mcpServerEnvSchema,
  SOLO_BYPASS_CLERK_SENTINEL,
};
