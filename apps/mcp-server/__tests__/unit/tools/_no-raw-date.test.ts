import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Clock-discipline guard (user S7a directive).
 *
 * Tool handlers MUST use `ctx.now()` instead of `new Date()` so that:
 *   - the registry is the single injection point for test-frozen clocks;
 *   - timezone + monotonicity behaviour is centralised;
 *   - no tool ships a hidden dependency on `global.Date` that would
 *     silently break determinism in a cross-timezone test environment.
 *
 * This test walks every `.ts` file under `src/tools/**` (excluding
 * test fixtures and the tool's own `schema.ts`/`manifest.ts`, which
 * would only use `Date` as a type) and fails CI if it finds any of
 * the following banned constructs:
 *
 *   - `new Date(...)` — wall-clock constructor.
 *   - `Date.now(...)` — millisecond timestamp reader (the more
 *     common sneak-in; user S7a review flagged this).
 *   - `Date.parse(...)` — reserved for belt-and-braces, even though
 *     it is always called with an arg today; catches future
 *     `Date.parse()` (no arg → current time) misuses too.
 *
 * The guard looks at source text, not the AST, so it catches the
 * most common failure mode — a developer pasting a stale snippet —
 * without requiring a full TypeScript compiler run.
 *
 * Legal exceptions:
 *   - `Date` used as a TYPE annotation (e.g. `readonly receivedAt: Date`)
 *     passes because the check greps for constructor/method calls, not
 *     the bare identifier.
 *   - `Date.UTC(...)` and other pure-computation Date statics are
 *     allowed — they do not read the clock.
 *   - Tests under `__tests__/` are NOT scanned — fixture creation
 *     legitimately mints Date values to pass to handlers that
 *     expect a pre-populated context.
 *
 * If a new tool genuinely needs a raw wall-clock read, the right
 * fix is to expose a new factory on the `ToolContext` shape (user
 * directive: the ToolContext shape is the authoritative dependency
 * list). Ad-hoc suppressions of this test are not permitted.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_ROOT = resolve(__dirname, '..', '..', '..', 'src', 'tools');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (s.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Banned wall-clock readers. Each entry is a human-readable label
 * plus a regex matched against every non-scan-excluded line of
 * every file under `src/tools/**`. Lexical match only (no AST);
 * comments are scanned deliberately so that a docblock cannot
 * quietly contain a banned substring even as prose — rephrase the
 * comment instead of suppressing the guard.
 */
const BANNED_CLOCKS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'new Date(', re: /\bnew\s+Date\s*\(/ },
  { label: 'Date.now(', re: /\bDate\s*\.\s*now\s*\(/ },
  { label: 'Date.parse(', re: /\bDate\s*\.\s*parse\s*\(/ },
];

describe('src/tools/** — no raw wall-clock reads (clock discipline)', () => {
  it('walks the tool tree and fails if any handler reads the wall clock directly', () => {
    const files = walk(TOOLS_ROOT);
    const offenders: Array<{ file: string; line: number; text: string; construct: string }> = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        for (const { label, re } of BANNED_CLOCKS) {
          if (re.test(line)) {
            offenders.push({ file, line: i + 1, text: line.trim(), construct: label });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line}  [${o.construct}]  →  ${o.text}`).join('\n');
      throw new Error(
        'clock-discipline guard failed — the following src/tools/ files read the wall clock directly; ' +
          `use ctx.now() instead:\n${msg}`,
      );
    }
    // Explicit positive assertion so the test reports a non-trivial
    // pass rather than a "nothing was asserted" warning.
    expect(offenders).toEqual([]);
  });

  it('walks at least one file (meta-check — catches an empty tree)', () => {
    expect(walk(TOOLS_ROOT).length).toBeGreaterThan(0);
  });

  it('regexes themselves match the patterns they claim to ban', () => {
    // Sanity check: if someone refactors a regex and accidentally
    // loosens it, this test locks the intent. Each sample below is
    // an idiomatic banned call; the regex for that label MUST match.
    const samples: Record<string, string> = {
      'new Date(': 'const x = new Date();',
      'Date.now(': 'const t = Date.now();',
      'Date.parse(': 'const p = Date.parse("2024-01-01");',
    };
    for (const { label, re } of BANNED_CLOCKS) {
      const sample = samples[label];
      expect(sample, `no sample defined for banned construct "${label}"`).toBeDefined();
      expect(re.test(sample as string), `regex for "${label}" should match sample: ${sample}`).toBe(true);
    }
    // Negative: `Date.UTC(` is pure computation and must NOT be
    // flagged by any of the three banned regexes.
    const legal = 'const u = Date.UTC(2024, 0, 1);';
    for (const { label, re } of BANNED_CLOCKS) {
      expect(re.test(legal), `regex for "${label}" wrongly flagged Date.UTC(`).toBe(false);
    }
  });
});
