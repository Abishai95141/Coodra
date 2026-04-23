import { z } from 'zod';

/**
 * Converts a Zod v4 input schema into a JSON Schema object suitable
 * for the MCP `tools/list` response's `inputSchema` field.
 *
 * Zod v4 ships a native `z.toJSONSchema(schema)` that produces
 * JSON Schema 2020-12 output. That replaces the third-party
 * `zod-to-json-schema` package that the Module 02 techstack.md
 * originally pinned under zod v3. The deviation is intentional —
 * keeping runtime and schema-generation under the same library
 * removes a version-coupling hazard and halves the bundle.
 *
 * We wrap `z.toJSONSchema` so that:
 *   1. Every consumer produces the same flavour of JSON Schema —
 *      no drift across tools.
 *   2. We can adjust `$id` / metadata in one place if the MCP SDK
 *      grows stricter validation in a future release.
 *   3. The return type is narrowed to a record (what the MCP SDK
 *      expects for `inputSchema`) rather than Zod's broader
 *      `JSONSchema` union.
 *
 * The schema must be a Zod `object` at the top level — MCP
 * tool-inputs are always JSON objects. We enforce that at runtime
 * as well as at the type level.
 */
export type JsonSchemaObject = {
  readonly type: 'object';
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: unknown;
  readonly [key: string]: unknown;
};

export function manifestFromZod(schema: z.ZodType): JsonSchemaObject {
  // z.toJSONSchema returns `unknown` by spec; we narrow + assert shape.
  const raw = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    // `unrepresentable: 'any'` makes unsupported Zod features
    // degrade to `{}` rather than throwing — we prefer loud failure
    // during development so we pass `'throw'` and fix the schema.
    unrepresentable: 'throw',
  }) as Record<string, unknown>;

  if (raw.type !== 'object') {
    throw new TypeError(
      `manifestFromZod: top-level schema must be a z.object; got type='${String(raw.type)}'. ` +
        'MCP tool inputs are required to be JSON objects.',
    );
  }

  return raw as JsonSchemaObject;
}
