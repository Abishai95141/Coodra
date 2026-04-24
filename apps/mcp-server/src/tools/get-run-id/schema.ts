import { z } from 'zod';

/**
 * Input schema for `contextos__get_run_id` (§24.4).
 *
 * `projectSlug` is the feature-pack-namespaced project identifier
 * (see `context_memory/decisions-log.md` 2026-04-24 12:15 "feature_
 * packs is single-namespace-by-slug" — the same slug convention the
 * MCP server uses for `feature-pack.get`). The handler resolves this
 * to `projects.id` via `projects.slug` unique lookup.
 */
export const getRunIdInputSchema = z
  .object({
    projectSlug: z
      .string()
      .min(1, 'projectSlug is required')
      .max(128, 'projectSlug must be at most 128 characters')
      .describe('Project slug (same namespace as feature-pack slugs — single global slug per §24.4).'),
  })
  .strict()
  .describe('Input for contextos__get_run_id.');

/**
 * Output schema — discriminated union on `ok`.
 *
 * The success branch returns the runId + ISO-8601 startedAt per
 * §24.4. The soft-failure branch carries a structured
 * `project_not_found` code + `howToFix` string so the calling agent
 * can surface actionable guidance to the user instead of a generic
 * tool-failure message. Per user directive Q1 (2026-04-24 14:00):
 * solo mode auto-creates the `projects` row (so this branch only
 * fires in team mode); team mode returns this branch so the user can
 * register the project via the Web App or `contextos init` CLI.
 *
 * Why discriminated union rather than throwing: the registry's
 * generic `handler_threw` envelope is reserved for programming bugs
 * (database outage, unexpected null). "Project not registered" is a
 * user-recoverable state; modeling it as data keeps the agent-
 * reading contract clean.
 */
const getRunIdSuccess = z
  .object({
    ok: z.literal(true),
    runId: z.string().min(1).describe('run:{projectId}:{sessionId}:{uuid} per §4.3 idempotency-key format.'),
    startedAt: z.string().datetime().describe('ISO 8601 timestamp the runs row was first inserted.'),
  })
  .strict();

const getRunIdProjectNotFound = z
  .object({
    ok: z.literal(false),
    error: z.literal('project_not_found'),
    howToFix: z
      .string()
      .min(1)
      .describe('Agent-surfaceable remediation string — register via Web App or `contextos init`.'),
  })
  .strict();

export const getRunIdOutputSchema = z.discriminatedUnion('ok', [getRunIdSuccess, getRunIdProjectNotFound]);

export type GetRunIdInput = z.infer<typeof getRunIdInputSchema>;
export type GetRunIdOutput = z.infer<typeof getRunIdOutputSchema>;
