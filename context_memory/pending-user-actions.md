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

## 2026-04-22 20:58 — Provision Clerk project (needed by Module 04 OR first team-mode flip, whichever is earlier)

**What is needed:** A Clerk project with a publishable key (`pk_test_...` or `pk_live_...`) and a secret key (`sk_test_...` or `sk_live_...`).
**Why:** Module 02 ships the Clerk JWT middleware wired-but-unvalidated against live Clerk (decision 2026-04-22 20:58, Q-02-5). The middleware is tested with mocks in solo-bypass; it has **not** been exercised against a real Clerk tenant. First live validation will happen either when Module 04 (Web App) starts calling the MCP server over HTTP in team mode, or when you flip `CONTEXTOS_MODE=team` for any reason before then — whichever comes first.
**Steps:** Create a free project at <https://clerk.com>, grab the keys from the dashboard. The Module 02 env schema validates that the secret matches `/^sk_(test|live)_/` and the publishable matches `/^pk_(test|live)_/`; the placeholder `sk_test_replace_me` is rejected in team mode (startup ValidationError).
**What to paste back:** Confirmation that both env vars are populated in `.env` (do NOT paste the keys themselves into chat — only confirmation). Also paste the `CLERK_JWT_ISSUER` URL (the `https://clerk.<your-tenant>.dev` value from the dashboard).
**Blocking module:** Module 04 OR first team-mode flip (whichever is earlier). **Not** blocking Module 02 merge — the server ships wired and the solo-bypass path is tested.

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
