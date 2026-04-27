import { z } from 'zod';

/**
 * Claude Code hook payload shape per `system-architecture.md` §3.2.
 *
 * Claude Code fires hooks as HTTP POST. Body shape (verbatim from §3.2):
 *
 *     {
 *       "hook_event_name": "PreToolUse",
 *       "session_id": "abc123",
 *       "tool_name": "Write",
 *       "tool_input": { "file_path": "src/auth.ts", "content": "..." },
 *       "tool_use_id": "tool-uuid-456",
 *       "cwd": "/home/dev/myapp"
 *     }
 *
 * `hook_event_name` is locked to the five events ContextOS cares about.
 * Other events are non-fatal but the `.strict()` wrapper means the
 * adapter rejects any unknown top-level field — that's what
 * `safeParse` is for at the route boundary; on parse failure the route
 * fails open with `permissionDecision: 'allow'` + WARN log.
 *
 * `tool_input` is intentionally `z.unknown()` because tool inputs vary
 * by tool (Write has `file_path` + `content`, Bash has `command`, etc.)
 * The adapter passes `tool_input` through unchanged.
 *
 * `prompt` + `prompt_id` are present on `UserPromptSubmit` events
 * only. They're optional here because the same schema is reused for
 * pre/post/session events.
 */
export const ClaudeCodeHookPayloadSchema = z
  .object({
    hook_event_name: z.enum(['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']),
    session_id: z.string().min(1),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    cwd: z.string().optional(),
    prompt: z.string().optional(),
    prompt_id: z.string().optional(),
  })
  .strict();

export type ClaudeCodeHookPayload = z.infer<typeof ClaudeCodeHookPayloadSchema>;
