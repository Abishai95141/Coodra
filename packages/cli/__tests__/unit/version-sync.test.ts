import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';

describe('VERSION matches package.json#version (sync-version.mjs invariant)', () => {
  it('prevents drift between package.json and src/version.ts', () => {
    const pkgJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(VERSION).toBe(pkgJson.version);
  });
});
