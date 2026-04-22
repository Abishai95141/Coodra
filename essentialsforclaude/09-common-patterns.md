# 09 — Common Code Patterns

> Every pattern below must be wired for real. If you cannot wire it end-to-end in this session (missing secret, missing infra), stop and ask per `02-agent-human-boundary.md` §2.3 — do not ship a proxy that hardcodes a success response.

## 9.1 Creating a new MCP Tool

Every MCP tool has three files colocated in `apps/mcp-server/src/tools/<tool-name>/`:

- `handler.ts` — the implementation
- `schema.ts` — Zod input/output schemas
- `manifest.ts` — exports `{ name, description, inputSchema }` (see `system-architecture.md` §24.7)

```typescript
// apps/mcp-server/src/tools/my-new-tool/handler.ts
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { myNewToolSchema, type MyNewToolInput } from './schema.js';

export async function myNewTool(input: MyNewToolInput) {
  const log = logger.child({ tool: 'my_new_tool', projectId: input.projectId });
  log.info('Tool invoked');

  try {
    const result = await db.query.someTable.findMany({
      where: eq(someTable.projectId, input.projectId),
    });

    log.info({ resultCount: result.length }, 'Tool completed');
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    log.error({ err }, 'Tool failed');
    return {
      content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
      isError: true,
    };
  }
}
```

```typescript
// apps/mcp-server/src/tools/my-new-tool/manifest.ts
export const manifest = {
  name: 'my_new_tool',
  description:
    "Call this when <trigger condition>. Returns <shape>. <Why the agent needs it>. <When NOT to call>.",
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      query: { type: 'string' },
    },
    required: ['projectId', 'query'],
  },
} as const;
```

The tool's `manifest.ts` description MUST follow the five-part recipe in `system-architecture.md` §24.3. A `manifest.test.ts` file asserts: starts with imperative trigger phrase, 40–80 words, mentions return shape.

## 9.2 Creating a new Hook Handler

```typescript
// apps/hooks-bridge/src/handlers/my-hook.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { logger } from '../lib/logger.js';

const inputSchema = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('MyEvent'),
  // ... fields
});

export const myHookRoute = new Hono().post(
  '/',
  zValidator('json', inputSchema),
  async (c) => {
    const input = c.req.valid('json');
    const log = logger.child({ hook: 'MyEvent', sessionId: input.session_id });
    log.info('Hook received');

    // ... handle

    return c.json({ status: 'ok' });
  },
);
```

## 9.3 Writing a Test

```typescript
// __tests__/unit/tools/my-new-tool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { myNewTool } from '../../../src/tools/my-new-tool/handler.js';

vi.mock('../../../src/lib/db.js', () => ({
  db: {
    query: {
      someTable: {
        findMany: vi.fn(),
      },
    },
  },
}));

describe('myNewTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns results for valid project', async () => {
    const { db } = await import('../../../src/lib/db.js');
    vi.mocked(db.query.someTable.findMany).mockResolvedValue([
      { id: '1', name: 'test' },
    ]);

    const result = await myNewTool({ projectId: 'uuid-here', query: 'test' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('test');
  });

  it('returns error for database failure', async () => {
    const { db } = await import('../../../src/lib/db.js');
    vi.mocked(db.query.someTable.findMany).mockRejectedValue(
      new Error('Connection refused'),
    );

    const result = await myNewTool({ projectId: 'uuid-here', query: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Connection refused');
  });
});
```
