import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { glob } from 'glob';
import { z } from 'zod';

/** IDEs we can wire `init` for. Order matters — preference for output. */
export type IDE = 'claude' | 'cursor' | 'windsurf';

export type Language = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java' | 'ruby';

export interface DetectionDeps {
  /** Override $HOME for test fixtures. */
  readonly homeDir?: string;
}

const PROJECT_ROOT_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', '.git'];

/**
 * Walk up from `cwd` looking for a project root marker (`package.json`,
 * `pyproject.toml`, `Cargo.toml`, `.git`). Returns the deepest match —
 * useful when a tool is run from a subdirectory of the repo.
 *
 * Returns the original cwd as a fallback if no marker is found anywhere
 * up the tree, so callers always get a usable path.
 */
export async function detectProjectRoot(cwd: string): Promise<{ root: string; markers: string[] }> {
  let current = resolve(cwd);
  const matches: { root: string; markers: string[] }[] = [];
  for (let depth = 0; depth < 12; depth++) {
    const found: string[] = [];
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        await access(join(current, marker));
        found.push(marker);
      } catch {
        // not present
      }
    }
    if (found.length > 0) {
      matches.push({ root: current, markers: found });
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (matches.length === 0) {
    return { root: resolve(cwd), markers: [] };
  }
  // The deepest match wins — that's the closest enclosing project root.
  return matches[0] as { root: string; markers: string[] };
}

const LANGUAGE_PATTERNS: Array<{ language: Language; patterns: string[] }> = [
  { language: 'typescript', patterns: ['**/*.ts', '**/*.tsx'] },
  { language: 'javascript', patterns: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'] },
  { language: 'python', patterns: ['**/*.py'] },
  { language: 'rust', patterns: ['**/*.rs'] },
  { language: 'go', patterns: ['**/*.go'] },
  { language: 'java', patterns: ['**/*.java'] },
  { language: 'ruby', patterns: ['**/*.rb'] },
];

const LANGUAGE_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/target/**',
];

/**
 * Returns languages present in the project root, deduped + ordered by total
 * file count (descending). Hidden directories and conventional build/install
 * outputs are excluded so the result reflects user-authored code.
 */
export async function detectLanguages(root: string): Promise<Language[]> {
  const counts: Map<Language, number> = new Map();
  for (const { language, patterns } of LANGUAGE_PATTERNS) {
    let count = 0;
    for (const pattern of patterns) {
      const matches = await glob(pattern, { cwd: root, ignore: LANGUAGE_IGNORE, nodir: true, dot: false });
      count += matches.length;
    }
    if (count > 0) counts.set(language, count);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}

/**
 * Look for IDE config dirs in $HOME. Each detected IDE gets one entry; the
 * order matches the IDE_DIRS list (Claude, Cursor, Windsurf). An empty array
 * means no supported IDE is installed — `init` warns the user.
 */
export async function detectIDE(deps: DetectionDeps = {}): Promise<IDE[]> {
  const home = deps.homeDir ?? homedir();
  const candidates: Array<{ ide: IDE; dir: string }> = [
    { ide: 'claude', dir: '.claude' },
    { ide: 'cursor', dir: '.cursor' },
    { ide: 'windsurf', dir: '.windsurf' },
  ];
  const found: IDE[] = [];
  for (const { ide, dir } of candidates) {
    try {
      await access(join(home, dir));
      found.push(ide);
    } catch {
      // not installed
    }
  }
  return found;
}

const mcpEntrySchema = z
  .object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const mcpConfigSchema = z
  .object({
    mcpServers: z.record(z.string(), mcpEntrySchema).optional(),
  })
  .passthrough();

export type MCPConfig = z.infer<typeof mcpConfigSchema>;

/**
 * Returns the parsed `.mcp.json` if the file exists and is valid; null when
 * the file is absent. Throws when the file exists but cannot be parsed —
 * `init` should treat that as an error condition the user must resolve.
 */
export async function detectExistingMCPConfig(root: string): Promise<MCPConfig | null> {
  const path = join(root, '.mcp.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
  return mcpConfigSchema.parse(JSON.parse(raw));
}
