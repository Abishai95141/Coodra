import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { TemplateDefinition } from './load-template.js';

/**
 * `lib/templates/detect` — picks the best-matching template for a
 * project root. Module 08b S13.
 *
 * Detection rules (per spec.md §7):
 *   A template MATCHES when at least one of:
 *     - any file in `detect.files` exists at projectRoot
 *     - any package.json dep matches `detect.packageJsonDeps`
 *     - `detect.cargoTomlPresent` and Cargo.toml exists
 *     - `detect.goModPresent` and go.mod exists
 *     - `detect.pyprojectTomlPresent` and pyproject.toml exists
 *
 * The `generic` template always matches (its `detect` block is empty
 * AND we treat it as the always-applicable fallback).
 *
 * When multiple templates match, the order of `availableTemplates`
 * decides — the caller is expected to pre-sort with the more-specific
 * templates first (typically: `nextjs-saas`, `python-fastapi`,
 * `python-ml`, `node-monorepo`, `rust-cli`, `go-service`, `generic`).
 */

export interface DetectResult {
  readonly chosen: TemplateDefinition | null;
  readonly considered: ReadonlyArray<{ readonly name: string; readonly matched: boolean; readonly reason: string }>;
}

export function detectTemplate(projectRoot: string, available: ReadonlyArray<TemplateDefinition>): DetectResult {
  const considered: { name: string; matched: boolean; reason: string }[] = [];
  let chosen: TemplateDefinition | null = null;

  // Read package.json deps once.
  const pkgJsonDeps = readPackageJsonDeps(projectRoot);

  for (const tmpl of available) {
    const matchResult = templateMatches(projectRoot, tmpl, pkgJsonDeps);
    considered.push({ name: tmpl.meta.name, matched: matchResult.matched, reason: matchResult.reason });
    if (chosen === null && matchResult.matched) {
      chosen = tmpl;
      // Don't break — continue collecting `considered` for diagnostics.
    }
  }
  return { chosen, considered };
}

interface MatchOutcome {
  readonly matched: boolean;
  readonly reason: string;
}

function templateMatches(
  projectRoot: string,
  tmpl: TemplateDefinition,
  pkgJsonDeps: ReadonlySet<string>,
): MatchOutcome {
  const detect = tmpl.meta.detect;

  // Generic template: special-cased — always matches as fallback.
  if (
    tmpl.meta.name === 'generic' &&
    detect.files.length === 0 &&
    detect.packageJsonDeps.length === 0 &&
    !detect.cargoTomlPresent &&
    !detect.goModPresent &&
    !detect.pyprojectTomlPresent
  ) {
    return { matched: true, reason: 'fallback (generic)' };
  }

  for (const f of detect.files) {
    if (existsSync(join(projectRoot, f))) {
      return { matched: true, reason: `file exists: ${f}` };
    }
  }
  for (const dep of detect.packageJsonDeps) {
    if (pkgJsonDeps.has(dep)) {
      return { matched: true, reason: `package.json dep: ${dep}` };
    }
  }
  if (detect.cargoTomlPresent && existsSync(join(projectRoot, 'Cargo.toml'))) {
    return { matched: true, reason: 'Cargo.toml present' };
  }
  if (detect.goModPresent && existsSync(join(projectRoot, 'go.mod'))) {
    return { matched: true, reason: 'go.mod present' };
  }
  if (detect.pyprojectTomlPresent && existsSync(join(projectRoot, 'pyproject.toml'))) {
    return { matched: true, reason: 'pyproject.toml present' };
  }
  return { matched: false, reason: 'no detection rule matched' };
}

function readPackageJsonDeps(projectRoot: string): ReadonlySet<string> {
  const path = join(projectRoot, 'package.json');
  if (!existsSync(path)) return new Set();
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return new Set();
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = new Set<string>();
    for (const k of Object.keys(parsed.dependencies ?? {})) deps.add(k);
    for (const k of Object.keys(parsed.devDependencies ?? {})) deps.add(k);
    return deps;
  } catch {
    return new Set();
  }
}
