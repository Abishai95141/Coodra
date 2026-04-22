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

## 2026-04-22 14:27 — Install Docker Desktop before Module 02 begins

**What is needed:** A running Docker daemon on the dev machine.
**Why:** From Module 02 onward, integration tests use `testcontainers` which spawns `pgvector/pgvector:pg16`. Without Docker, `pnpm test:integration` cannot run.
**Steps:** Install Docker Desktop for macOS from <https://www.docker.com/products/docker-desktop> and start it. Verify with `docker --version` and `docker info`.
**What to paste back:** Output of `docker --version` (expected format: `Docker version 24.x.x, build ...`).
**Blocking module:** Module 02 (MCP Server integration tests).

## 2026-04-22 14:27 — Provision Clerk project before Module 04 begins

**What is needed:** A Clerk project with a publishable key and secret key.
**Why:** Module 04 (Web App) team-mode auth requires real Clerk credentials. Solo mode keeps using the `sk_test_replace_me` bypass.
**Steps:** Create a free project at <https://clerk.com>, grab the keys from the dashboard (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), paste them into `.env` locally.
**What to paste back:** Confirmation that both env vars are populated in `.env` (do NOT paste the keys themselves into chat — only confirmation).
**Blocking module:** Module 04 (Web App).

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

## 2026-04-22 14:27 — GitHub App registration before §23 GitHub tools ship (within Module 02)

**What is needed:** A GitHub App registered at <https://github.com/settings/apps>, installed on the target org, with App ID, webhook secret, client ID, client secret, and private-key PEM.
**Why:** All 10 GitHub MCP tools in `system-architecture.md` §23 authenticate as a GitHub App (per `External api and library reference.md` → GitHub Governance & Context Layer).
**Steps:** Register an App, add webhook URL (will be the Module-03 Hooks Bridge URL), configure required permissions (per §23), install on at least one repo, generate and download the private key.
**What to paste back:** `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (populated in `.env`), and the PEM uploaded to the agreed secret store (never committed).
**Blocking module:** Module 02 (when GitHub tools are implemented).

## 2026-04-22 14:27 — Atlassian OAuth 2.0 (3LO) app registration before §22 JIRA tools ship (within Module 02)

**What is needed:** An Atlassian Cloud Developer Console app with OAuth 2.0 (3LO) enabled, client ID, client secret, and a registered webhook.
**Why:** All 8 JIRA MCP tools in `system-architecture.md` §22 authenticate via 3LO.
**Steps:** Register at <https://developer.atlassian.com/console/myapps/>, enable Jira Cloud Platform scopes, set callback URL (Module-03 Hooks Bridge URL), generate a webhook secret.
**What to paste back:** `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_WEBHOOK_SECRET` populated in `.env`.
**Blocking module:** Module 02 (when JIRA tools are implemented).
