import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

/**
 * `lib/templates/load-template` — read + validate a template.json from
 * a resolved template directory. Module 08b S13.
 *
 * The shape is intentionally minimal:
 *   - name + description for `template list` display
 *   - languages: which programming-language buckets the template
 *     applies to; used by the auto-detection scoring in
 *     `lib/templates/detect.ts` (S13) and by future M05 NL-Assembly
 *     scoring.
 *   - detect: the conditions under which `--mode auto` selects this
 *     template (file presence OR package.json dep match).
 *   - autoSections: the set of `<!-- @auto:<section> -->` markers the
 *     template's *.tmpl files contain. M08b S15's auto-populator only
 *     writes content for sections listed here.
 *   - version + author for future template-registry needs.
 */

const TemplateJsonSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    description: z.string().min(1).max(500),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+/)
      .default('1.0.0'),
    author: z.string().optional(),
    languages: z.array(z.string().min(1)).default([]),
    detect: z
      .object({
        files: z.array(z.string()).default([]),
        packageJsonDeps: z.array(z.string()).default([]),
        cargoTomlPresent: z.boolean().default(false),
        goModPresent: z.boolean().default(false),
        pyprojectTomlPresent: z.boolean().default(false),
      })
      .default({
        files: [],
        packageJsonDeps: [],
        cargoTomlPresent: false,
        goModPresent: false,
        pyprojectTomlPresent: false,
      }),
    autoSections: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).default([]),
  })
  .strict();

export type TemplateJson = z.infer<typeof TemplateJsonSchema>;

export interface TemplateDefinition {
  /** Where the template lives on disk. */
  readonly dir: string;
  /** Parsed + validated template.json. */
  readonly meta: TemplateJson;
  /** The four .tmpl source contents, read once into memory. */
  readonly sources: {
    readonly spec: string;
    readonly implementation: string;
    readonly techstack: string;
    readonly meta: string;
  };
}

export class TemplateLoadError extends Error {
  readonly code: 'missing_template_json' | 'invalid_template_json' | 'missing_tmpl_file';
  readonly details?: { path?: string; issues?: unknown };
  constructor(
    code: 'missing_template_json' | 'invalid_template_json' | 'missing_tmpl_file',
    message: string,
    details?: { path?: string; issues?: unknown },
  ) {
    super(message);
    this.name = 'TemplateLoadError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const REQUIRED_TMPL_FILES = ['spec.md.tmpl', 'implementation.md.tmpl', 'techstack.md.tmpl', 'meta.json.tmpl'] as const;

export async function loadTemplate(dir: string): Promise<TemplateDefinition> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'template.json'), 'utf8');
  } catch (err) {
    throw new TemplateLoadError(
      'missing_template_json',
      `template.json not found in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      { path: join(dir, 'template.json') },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TemplateLoadError(
      'invalid_template_json',
      `template.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { path: join(dir, 'template.json') },
    );
  }
  const result = TemplateJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new TemplateLoadError(
      'invalid_template_json',
      `template.json failed schema validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      { path: join(dir, 'template.json'), issues: result.error.issues },
    );
  }

  const sources: Record<(typeof REQUIRED_TMPL_FILES)[number], string> = {
    'spec.md.tmpl': '',
    'implementation.md.tmpl': '',
    'techstack.md.tmpl': '',
    'meta.json.tmpl': '',
  };
  for (const fname of REQUIRED_TMPL_FILES) {
    try {
      sources[fname] = await readFile(join(dir, fname), 'utf8');
    } catch (err) {
      throw new TemplateLoadError(
        'missing_tmpl_file',
        `${fname} not found in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        { path: join(dir, fname) },
      );
    }
  }

  return {
    dir,
    meta: result.data,
    sources: {
      spec: sources['spec.md.tmpl'],
      implementation: sources['implementation.md.tmpl'],
      techstack: sources['techstack.md.tmpl'],
      meta: sources['meta.json.tmpl'],
    },
  };
}
