import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Language } from '../detect.js';
import type { WriteOutcome } from './types.js';

export interface SeedFeaturePackOptions {
  readonly cwd: string;
  readonly slug: string;
  readonly languages: readonly Language[];
  readonly force: boolean;
  readonly dryRun: boolean;
}

const LANGUAGE_GLOB: Record<Language, string[]> = {
  typescript: ['**/*.ts', '**/*.tsx'],
  javascript: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
  python: ['**/*.py'],
  rust: ['**/*.rs'],
  go: ['**/*.go'],
  java: ['**/*.java'],
  ruby: ['**/*.rb'],
};

export async function seedFeaturePack(options: SeedFeaturePackOptions): Promise<WriteOutcome[]> {
  const dir = join(options.cwd, 'docs', 'feature-packs', options.slug);
  const metaPath = join(dir, 'meta.json');
  const specPath = join(dir, 'spec.md');
  const outcomes: WriteOutcome[] = [];

  if (!options.dryRun) await mkdir(dir, { recursive: true });

  const sourceFiles = options.languages.flatMap((lang) => LANGUAGE_GLOB[lang]);
  const meta = {
    slug: options.slug,
    parentSlug: null,
    sourceFiles: sourceFiles.length > 0 ? sourceFiles : ['**/*'],
    isActive: true,
  };
  outcomes.push(await writeIfAbsent(metaPath, `${JSON.stringify(meta, null, 2)}\n`, options));
  outcomes.push(await writeIfAbsent(specPath, buildSpecSkeleton(options.slug), options));
  return outcomes;
}

async function writeIfAbsent(
  path: string,
  body: string,
  options: { force: boolean; dryRun: boolean },
): Promise<WriteOutcome> {
  const exists = await pathExists(path);
  if (!exists) {
    if (!options.dryRun) await writeFile(path, body, 'utf8');
    return { path, action: 'wrote' };
  }
  if (options.force) {
    if (!options.dryRun) await writeFile(path, body, 'utf8');
    return { path, action: 'forced' };
  }
  return { path, action: 'unchanged', notes: 'file exists; pass --force to overwrite' };
}

function buildSpecSkeleton(slug: string): string {
  return [
    `# ${slug} — Spec`,
    '',
    '> **Status:** TODO — fill in after first implementation pass.',
    '',
    '## 1. What it is',
    '',
    'TODO',
    '',
    '## 2. Acceptance criteria',
    '',
    '- [ ] TODO',
    '',
    '## 3. Non-goals',
    '',
    'TODO',
    '',
  ].join('\n');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
