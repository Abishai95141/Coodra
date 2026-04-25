import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { manifestFromZod } from '../../../src/framework/manifest-from-zod.js';

describe('manifestFromZod', () => {
  it('converts a simple z.object to a JSON Schema 2020-12 object', () => {
    const schema = z.object({
      name: z.string().min(1),
      count: z.number().int().nonnegative().default(0),
    });
    const json = manifestFromZod(schema) as Record<string, unknown>;
    expect(json.type).toBe('object');
    expect(json).toHaveProperty('properties');
    const props = json.properties as Record<string, unknown>;
    expect(props).toHaveProperty('name');
    expect(props).toHaveProperty('count');
  });

  it('carries through .describe() annotations to the JSON Schema description field', () => {
    const schema = z.object({
      echo: z.string().optional().describe('human-readable echo value'),
    });
    const json = manifestFromZod(schema) as Record<string, unknown>;
    const props = json.properties as Record<string, { description?: string }>;
    expect(props.echo?.description).toBe('human-readable echo value');
  });

  it('rejects a non-object top-level schema — MCP tool inputs must be objects', () => {
    expect(() => manifestFromZod(z.string())).toThrow(/top-level schema must be a z\.object/);
    expect(() => manifestFromZod(z.array(z.number()))).toThrow(/top-level schema must be a z\.object/);
  });

  it('produces a valid Ajv-compatible schema (structural smoke test)', () => {
    // We do not pull Ajv as a dep here — the real Ajv round-trip lives
    // in the §24.9 manifest-e2e test. This is a structural lock that
    // the output shape is a pure JSON-serialisable record (no Zod
    // internals leaking through).
    const schema = z.object({
      echo: z.string().optional(),
    });
    const json = manifestFromZod(schema);
    const serialised = JSON.stringify(json);
    const reparsed = JSON.parse(serialised) as Record<string, unknown>;
    expect(reparsed.type).toBe('object');
    expect(reparsed).not.toHaveProperty('_def');
    expect(reparsed).not.toHaveProperty('parse');
  });
});
