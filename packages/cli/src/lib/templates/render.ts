import type { TemplateDefinition } from './load-template.js';

/**
 * `lib/templates/render` — pure mustache-style substitution against a
 * loaded TemplateDefinition. Module 08b S13.
 *
 * Recognised placeholders (unknown placeholders pass through verbatim
 * so user-edited content survives):
 *
 *   {{slug}}              → context.slug (project slug)
 *   {{date}}              → context.date ?? new Date().toISOString().slice(0,10)
 *   {{language}}          → context.languages joined with ', ' (deprecated;
 *                           prefer {{detectedLanguages}})
 *   {{detectedLanguages}} → languages joined with ', '
 *   {{detectedDeps}}      → context.detectedDeps joined with ', '
 *   {{templateName}}      → template.meta.name
 *   {{templateVersion}}   → template.meta.version
 *
 * Substitution is hand-rolled (no template engine dep). Whitespace
 * inside `{{ }}` is normalised — `{{ slug }}` and `{{slug}}` both
 * resolve.
 */

export interface RenderTemplateContext {
  readonly slug: string;
  readonly date?: string;
  readonly languages?: ReadonlyArray<string>;
  readonly detectedDeps?: ReadonlyArray<string>;
  readonly description?: string;
}

export interface RenderTemplateResult {
  readonly 'spec.md': string;
  readonly 'implementation.md': string;
  readonly 'techstack.md': string;
  readonly 'meta.json': string;
}

export function renderTemplate(template: TemplateDefinition, context: RenderTemplateContext): RenderTemplateResult {
  const date = context.date ?? new Date().toISOString().slice(0, 10);
  const languages = context.languages ?? template.meta.languages;
  const detectedDeps = context.detectedDeps ?? [];
  const replacements: Readonly<Record<string, string>> = {
    slug: context.slug,
    date,
    language: languages.join(', '),
    detectedLanguages: languages.length === 0 ? 'unspecified' : languages.join(', '),
    detectedDeps: detectedDeps.length === 0 ? 'no dependencies detected' : detectedDeps.join(', '),
    templateName: template.meta.name,
    templateVersion: template.meta.version,
    description: context.description ?? template.meta.description,
  };

  return {
    'spec.md': substitute(template.sources.spec, replacements),
    'implementation.md': substitute(template.sources.implementation, replacements),
    'techstack.md': substitute(template.sources.techstack, replacements),
    'meta.json': substitute(template.sources.meta, replacements),
  };
}

function substitute(source: string, replacements: Readonly<Record<string, string>>): string {
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (Object.hasOwn(replacements, key)) {
      return replacements[key] ?? '';
    }
    // Unknown placeholder — pass through verbatim.
    return match;
  });
}
