# 07 — Style and Conventions

## 7.1 TypeScript

- **Formatter/Linter:** Biome (`biome.json` at root). Run `pnpm lint` before committing.
- **Indent:** 2 spaces
- **Quotes:** Single quotes
- **Trailing commas:** Always
- **Line width:** 120 characters
- **Semicolons:** Always
- **Imports:** Organized by Biome (builtin → external → internal)

## 7.2 Python

- **Formatter:** Ruff (configured in `pyproject.toml`)
- **Type hints:** Mandatory on all functions
- **Docstrings:** Google style
- **Line width:** 120 characters

## 7.3 Git

### Commit messages — Conventional Commits

- `feat: add get_feature_pack MCP tool`
- `fix: handle null parent_pack_id in inheritance resolution`
- `test: add integration tests for policy engine`
- `docs: update MCP server spec with error codes`
- `chore: update drizzle-orm to 0.38.1`

### Branch strategy

- Feature branches off `main`.
- Names: `feat/02-mcp-server-tools`, `fix/policy-engine-null-check`.

### Merge strategy

- Squash merge to `main`. Clean, linear history.

## 7.4 Environment variables

All env vars are documented in `.env.example`. Copy to `.env` for local development:

```bash
cp .env.example .env
```

**Validation:** Every service validates required env vars at startup using Zod. If a required variable is missing, the service fails fast with a clear error message. Never use a fallback for secrets.

```typescript
// Example: apps/mcp-server/src/config.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  MCP_SERVER_PORT: z.coerce.number().default(3100),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CLERK_SECRET_KEY: z.string().min(1),
});

export const config = envSchema.parse(process.env);
```

## 7.5 CI/CD Pipeline

Defined in `.github/workflows/ci.yml`:

```
Every push/PR:
  ├── lint-typecheck     (parallel: biome lint + tsc --noEmit)
  ├── test-unit          (Vitest unit tests, needs lint-typecheck)
  ├── test-integration   (Vitest + real Postgres/Redis, needs lint-typecheck)
  └── test-python        (pytest for nl-assembly + semantic-diff, needs lint-typecheck)

Main branch only (after all above pass):
  ├── test-e2e           (full lifecycle tests)
  └── build-images       (Docker images for mcp-server, hooks-bridge, web)
```

**Before pushing code, always run locally:**

```bash
pnpm lint              # Biome lint + format check
pnpm typecheck         # TypeScript type checking
pnpm test:unit         # Unit tests
```
