# @contextos/cli

> **Status:** in development on `feat/08a-cli`. Not yet published to npm — the publish-flag-day is tracked separately as a user-side ops task.

The single-binary install / configure / run / diagnose surface for ContextOS, the MCP server platform that gives AI coding agents (Claude Code, Cursor, Windsurf) Feature Packs, Context Packs, and policy enforcement.

## Install

```bash
# Global install (recommended for repeat use)
npm i -g @contextos/cli

# One-shot use without installing
npx @contextos/cli init
```

## Commands

| Command | Purpose |
|---|---|
| `contextos init [--project-slug] [--ide] [--no-graphify] [--dry-run] [--force]` | Set up ContextOS in the current project: writes `~/.contextos/`, applies migrations + seeds the F7 sentinel project, merges `.mcp.json`, writes `.contextos.json`, writes `.env` with solo-mode sentinels, seeds a Feature Pack folder. Idempotent merge by default; `--force` overwrites baselines. |
| `contextos start [--no-mcp] [--no-hooks] [--foreground]` | Launch MCP Server + Hooks Bridge as background daemons via the platform's native manager (launchd / systemd) or detached fallback. Polls `/healthz` until ready. |
| `contextos stop [--service <name>] [--uninstall]` | Stop running daemons. Idempotent. `--uninstall` also removes the daemon-manager unit. |
| `contextos status [--json]` | Print unified project + service state for the current cwd: project slug + registration, mode, service health probes (MCP `/healthz` + bridge `/healthz`), recent run + last decision + open blockers. |
| `contextos doctor [--json] [--timeout-ms <ms>]` | 20-check read-only health report covering Node / `~/.contextos/` / data.db / migrations / F7 sentinel / F8 + F14 + F15 invariants / `/healthz` / IDE detection / daemon manager / port availability / `LOCAL_HOOK_SECRET` / Module 03.1 placeholder. |
| `contextos team login [token] [--server <url>]` | **Stub in 08a.** Surface lives; body lands when team mode reaches GA. Exits 2. |
| `contextos team logout` | **Stub in 08a.** Same status. |
| `contextos --version` / `--help` | Standard CLI metadata. Per-subcommand `--help` available. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success / idempotent no-op |
| 1 | User-recoverable failure (missing file, wrong dir, project unregistered) |
| 2 | User action required (team mode not GA, port in use, all services down) |
| 3 | Environment problem (daemon manager unreachable, Node too old, file collision) |
| 4 | Service startup failed (daemon installed but `/healthz` never returned ok) |

These codes are stable across versions — shell scripts can rely on them.

## Where files live

`contextos init` resolves `~/.contextos/` per Decision 2 (signed off 2026-04-27):

| Platform | Path |
|---|---|
| Linux + `$XDG_CONFIG_HOME` set | `$XDG_CONFIG_HOME/contextos/` |
| Linux without XDG | `$HOME/.contextos/` |
| macOS / Windows | `$HOME/.contextos/` |

Override with `CONTEXTOS_HOME=/path/to/dir` in the environment.

## Documentation

- Full spec — [`docs/feature-packs/08a-cli/spec.md`](../../docs/feature-packs/08a-cli/spec.md)
- Implementation plan — [`docs/feature-packs/08a-cli/implementation.md`](../../docs/feature-packs/08a-cli/implementation.md)
- Tech stack — [`docs/feature-packs/08a-cli/techstack.md`](../../docs/feature-packs/08a-cli/techstack.md)
- Contributor dev-loop — [`docs/DEVELOPMENT.md` § Iterating on the CLI](../../docs/DEVELOPMENT.md)
- The 11 ADRs — [`essentialsforclaude/11-adrs.md`](../../essentialsforclaude/11-adrs.md)

## License

MIT
