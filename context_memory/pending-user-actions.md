# Pending User Actions

Things only the user can do (per `essentialsforclaude/02-agent-human-boundary.md` §2.2). The agent must never fake these. Move resolved items out of this file when the user confirms the action is complete.

Format:

```
## YYYY-MM-DD HH:mm — <short title>
**What is needed:** <concrete artifact — env var name / account / URL>
**Why:** <which module or feature this blocks>
**Steps:** <URL + UI steps the user follows>
**What to paste back:** <exact string the user returns>
**Blocking module:** <N — Name, or "non-blocking for now">
```

---

## 2026-04-22 20:58 — Install Docker Desktop (DUE NOW — Module 02 integration tests)

**What is needed:** A running Docker daemon on the dev machine.
**Why:** Module 02 is in progress. From S17 onward the integration tests spawn a `pgvector/pgvector:pg16` container via `@testcontainers/postgresql`. Without Docker, `pnpm --filter @contextos/mcp-server test:integration` cannot run locally and the Module 02 acceptance gate fails on item AC-5. CI does not need Docker install because GitHub's `ubuntu-latest` runners ship with a Docker daemon.
**Steps:** Install Docker Desktop for macOS from <https://www.docker.com/products/docker-desktop> and start it. Verify with `docker --version` and `docker info`.
**What to paste back:** Output of `docker --version` (expected format: `Docker version 24.x.x, build ...`).
**Blocking module:** Module 02 (MCP Server integration tests, starting at S17).

## 2026-04-22 20:58 — Provision Clerk project (needed by Module 04 OR first team-mode flip, whichever is earlier) — S7b-refreshed 2026-04-24

**What is needed:** A Clerk project with a publishable key (`pk_test_...` or `pk_live_...`) and a secret key (`sk_test_...` or `sk_live_...`).
**Why:** Module 02 S7b ships the real `@clerk/backend@3.3.0::verifyToken` integration in `apps/mcp-server/src/lib/auth.ts`. All unit tests exercise the wire code via `@clerk/backend`'s own mocking surface (see `__tests__/unit/lib/auth-chain.test.ts`) — that is real wire code with a test double, not a shallow proxy. The middleware has **not** been exercised against a real Clerk tenant yet. First live validation is a Module 04 precondition: Module 04's first acceptance criterion must include a smoke test against a real Clerk dev project that calls the MCP server over HTTP with a real Bearer token, so the gap closes the moment keys land.
**Steps:** Create a free project at <https://clerk.com>, grab the keys from the dashboard. The Module 02 env schema validates that the secret matches `/^sk_(test|live)_/` and the publishable matches `/^pk_(test|live)_/`; the placeholder `sk_test_replace_me` is rejected in team mode (startup ValidationError).
**What to paste back:** Confirmation that both env vars are populated in `.env` (do NOT paste the keys themselves into chat — only confirmation). Also paste the `CLERK_JWT_ISSUER` URL (the `https://clerk.<your-tenant>.dev` value from the dashboard).
**Blocking module:** Module 04 OR first team-mode flip (whichever is earlier). **Not** blocking Module 02 merge — the server ships wired and the solo-bypass path is tested end-to-end.

## 2026-04-24 10:45 — `LOCAL_HOOK_SECRET` config-file reads via a future `contextos team login` CLI

**What is needed:** A dedicated CLI command (`contextos team login`) that writes `~/.contextos/config.json` with the team-mode secret, per `system-architecture.md` §19's spec. Tracking this here because S7b's `lib/auth.ts::verifyLocalHookSecret` currently reads the secret from the `LOCAL_HOOK_SECRET` env var only.
**Why:** §19 says the shared secret belongs in `~/.contextos/config.json`, not in a process env var. Module 02 S7b scoped this intentionally to env-only (decisions-log 2026-04-24 — user S7b directive Q7). The follow-up is a dedicated module (Module 07 VS Code Extension, or a dedicated distribution module) that ships the CLI; until then, team-mode operators set the env var manually and the env schema validates `≥16 chars`.
**Steps:** No user action today. This entry exists so the follow-up is not forgotten when Module 07 opens.
**What to paste back:** Nothing now. When the CLI module ships, the `lib/auth.ts::verifyLocalHookSecret` integration will switch to reading `~/.contextos/config.json` first, env var second.
**Blocking module:** None for Module 02. Follow-up for Module 07 / dedicated distribution module.

## 2026-04-22 14:27 — Provision team-mode cloud infra before team deploy

**What is needed:** Supabase Postgres project (pgvector enabled), Upstash Redis database, Railway or Fly.io account, production domain + DNS.
**Why:** Team-mode cloud deploy per `system-architecture.md` §13.
**Steps:** Create accounts on the respective dashboards; provision one project per service. Populate `.env.production` locally (never committed) with the resulting URLs / keys.
**What to paste back:** Confirmation per service (names only, not secrets).
**Blocking module:** Team-mode cloud deploy (post-Module-04).

## 2026-04-22 14:27 — Anthropic + (optional) Gemini / OpenAI API keys before Module 05

**What is needed:** `ANTHROPIC_API_KEY` (required); optionally `GEMINI_API_KEY` and/or `OPENAI_API_KEY`.
**Why:** NL Assembly Tier-3 enrichment and Semantic Diff narrative use Claude as the primary LLM (per `system-architecture.md` §18).
**Steps:** Create keys at <https://console.anthropic.com> (and optionally <https://aistudio.google.com/app/apikey>, <https://platform.openai.com/api-keys>). Paste into `.env` locally.
**What to paste back:** Confirmation that `ANTHROPIC_API_KEY` is populated (do NOT paste the key).
**Blocking module:** Module 05 (NL Assembly) Tier-3; Module 06 (Semantic Diff) narrative.

## 2026-04-22 14:27 — GitHub App registration before §23 GitHub tools ship (post-Module-02 integration module)

**What is needed:** A GitHub App registered at <https://github.com/settings/apps>, installed on the target org, with App ID, webhook secret, client ID, client secret, and private-key PEM.
**Why:** All 10 GitHub MCP tools in `system-architecture.md` §23 authenticate as a GitHub App (per `External api and library reference.md` → GitHub Governance & Context Layer).
**Steps:** Register an App, add webhook URL (will be the Module-03 Hooks Bridge URL), configure required permissions (per §23), install on at least one repo, generate and download the private key.
**What to paste back:** `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (populated in `.env`), and the PEM uploaded to the agreed secret store (never committed).
**Blocking module:** Post-Module-02 GitHub integration module (Module 02 explicitly does NOT ship JIRA/GitHub tools per directive Step 2 non-goals; those land in a dedicated integration module after Module 02 merges).

## 2026-04-22 14:27 — Atlassian OAuth 2.0 (3LO) app registration before §22 JIRA tools ship (post-Module-02 integration module)

**What is needed:** An Atlassian Cloud Developer Console app with OAuth 2.0 (3LO) enabled, client ID, client secret, and a registered webhook.
**Why:** All 8 JIRA MCP tools in `system-architecture.md` §22 authenticate via 3LO.
**Steps:** Register at <https://developer.atlassian.com/console/myapps/>, enable Jira Cloud Platform scopes, set callback URL (Module-03 Hooks Bridge URL), generate a webhook secret.
**What to paste back:** `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_WEBHOOK_SECRET` populated in `.env`.
**Blocking module:** Post-Module-02 JIRA integration module (Module 02 explicitly does NOT ship JIRA/GitHub tools per directive Step 2 non-goals; those land in a dedicated integration module after Module 02 merges).
