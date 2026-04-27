# Manual verification harnesses

Each script is a runnable one-shot, NOT a vitest target. Runs against the *built* dist (`apps/{mcp-server,hooks-bridge}/dist/index.js`) — `pnpm build` first if source changed.

| Harness | Run with | What it covers |
|---|---|---|
| `verify.ts` | `pnpm exec tsx __tests__/manual/verify.ts` | M01+M02 stdio walk of all 9 MCP tools against a fresh sqlite. |
| `verify-m1-m3.ts` | `pnpm exec tsx __tests__/manual/verify-m1-m3.ts` | M01+M02+M03 stdio walk of all 9 MCP tools (extends `verify.ts` with bridge-touched paths). |
| `verify-save-pack.ts` | `pnpm exec tsx __tests__/manual/verify-save-pack.ts` | Spawns a fresh stdio MCP subprocess and saves a context pack — recovery harness when the IDE's MCP subprocess has died. |
| `verify-sigterm-drain.ts` | `pnpm exec tsx __tests__/manual/verify-sigterm-drain.ts` | Phase 2.6 graceful-shutdown drain — fires `check_policy`, sends SIGTERM, asserts the async audit insert lands before exit. |
| `verify-f5-live.ts` | `pnpm exec tsx __tests__/manual/verify-f5-live.ts` | F5 closure live demo — spawns a fresh stdio subprocess against the rebuilt dist and calls `check_policy({ sessionId: 'has:colon' })` to confirm `runKeySegmentSchema` rejects the colon at the MCP boundary. |
| `verify-phase5-loop.ts` | (long-running services; see file header) | Phase 5 closed-loop test — assumes a bridge + MCP HTTP server are already running against a shared sqlite DB. |
| `verify-phase5-closed-loop.ts` | `LOCAL_HOOK_SECRET=<hex> pnpm exec tsx __tests__/manual/verify-phase5-closed-loop.ts` | Phase 5 closed-loop test — assumes a bridge is running on `127.0.0.1:3201` against `/tmp/p4p5-verify/data.db`; spawns its own MCP stdio subprocess against the same DB and walks SessionStart → MCP `get_run_id` (with `agentSessionId`) → Pre/Post → `record_decision` → Stop → `query_run_history`. F8/F9/F10/F14 invariants visible end-to-end. |
| `_drain.mjs`, `_migrate.mjs` | (sourced by other harnesses) | Internal helpers. |

Standing rule: harnesses talk to the **built dist**. If you change source, `pnpm build` first or you'll be testing stale code (the trap that produced the IDE-MCP-subprocess staleness finding in M02).
