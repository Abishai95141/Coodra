import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { Check } from '../types.js';

const mcpConfigSchema = z.object({
  mcpServers: z
    .record(
      z.string(),
      z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export const mcpConfigValidityCheck: Check = {
  id: 14,
  name: '.mcp.json parses + ContextOS entry command path resolves',
  severity: 'yellow',
  async run(ctx) {
    const path = join(ctx.cwd, '.mcp.json');
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          status: 'yellow',
          detail: `.mcp.json not found at ${path}`,
          remediation: 'Run `contextos init` to write a baseline .mcp.json.',
        };
      }
      return { status: 'yellow', detail: `cannot read .mcp.json: ${(err as Error).message}` };
    }
    let parsed: z.infer<typeof mcpConfigSchema>;
    try {
      parsed = mcpConfigSchema.parse(JSON.parse(raw));
    } catch (err) {
      return {
        status: 'yellow',
        detail: `.mcp.json invalid: ${(err as Error).message}`,
        remediation: 'Re-run `contextos init` to rewrite a valid .mcp.json.',
      };
    }
    const entry = parsed.mcpServers?.contextos;
    if (entry === undefined) {
      return {
        status: 'yellow',
        detail: '.mcp.json has no `contextos` entry under mcpServers',
        remediation: 'Run `contextos init` to add the ContextOS MCP server entry.',
      };
    }
    const cmd = entry.command;
    if (cmd === 'npx') {
      return {
        status: 'yellow',
        detail: ".mcp.json `contextos.command` is `npx` — npx-cache paths can be GC'd unexpectedly",
        remediation: 'Install globally with `npm i -g @contextos/cli` for stable resolution (see techstack Gotchas).',
      };
    }
    if (isAbsolute(cmd)) {
      try {
        await access(cmd);
      } catch {
        return {
          status: 'yellow',
          detail: `.mcp.json points at ${cmd} but that path is not present`,
          remediation: 'Run `contextos init` to update .mcp.json with the current install path.',
        };
      }
    }
    return { status: 'green', detail: `.mcp.json valid; ContextOS entry command=${cmd}` };
  },
};
