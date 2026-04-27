import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGlobalProject, ensureProject, migrateSqlite } from '@contextos/db';
import pc from 'picocolors';
import { EXIT_ENVIRONMENT_PROBLEM, EXIT_OK, EXIT_USER_ACTION_REQUIRED, EXIT_USER_RECOVERABLE } from '../exit-codes.js';
import { resolveContextosHome, resolveContextosLogsDir, resolveContextosPidsDir } from '../lib/contextos-home.js';
import { detectIDE, detectLanguages, detectProjectRoot } from '../lib/detect.js';
import { findRepoRoot } from '../lib/find-repo-root.js';
import { writeContextosJson } from '../lib/init/contextos-json.js';
import { type BaselineEnv, mergeEnvFile } from '../lib/init/env-merge.js';
import { seedFeaturePack } from '../lib/init/feature-pack-seed.js';
import { buildContextosMcpEntry, mergeMcpJson } from '../lib/init/mcp-merge.js';
import type { WriteOutcome } from '../lib/init/types.js';
import { openLocalDb } from '../lib/open-local-db.js';

export interface InitOptions {
  readonly projectSlug?: string;
  readonly ide?: string;
  readonly graphify?: boolean;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly cwd?: string;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface InitIO {
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
  readonly exit: (code: number) => never;
}

export const DEFAULT_INIT_IO: InitIO = {
  writeStdout: (chunk) => {
    process.stdout.write(chunk);
  },
  writeStderr: (chunk) => {
    process.stderr.write(chunk);
  },
  exit: (code) => {
    process.exit(code);
  },
};

export interface InitReport {
  readonly projectRoot: string;
  readonly contextosHome: string;
  readonly projectSlug: string;
  readonly languages: string[];
  readonly ides: string[];
  readonly outcomes: WriteOutcome[];
  readonly dryRun: boolean;
}

export async function runInitCommand(options: InitOptions = {}, io: InitIO = DEFAULT_INIT_IO): Promise<never> {
  const env = options.env ?? process.env;
  const dryRun = options.dryRun === true;
  const force = options.force === true;

  const cwd = resolve(options.cwd ?? process.cwd());
  const detection = await detectProjectRoot(cwd);
  if (detection.markers.length === 0) {
    io.writeStderr(
      `${pc.red('contextos init')}: no project root marker found near ${cwd}. ` +
        'Run init from a directory that contains package.json, pyproject.toml, Cargo.toml, or .git.\n',
    );
    return io.exit(EXIT_USER_RECOVERABLE);
  }
  const root = detection.root;
  const projectSlug = sanitizeSlug(options.projectSlug ?? basename(root));
  if (projectSlug.length === 0) {
    io.writeStderr(`${pc.red('contextos init')}: could not derive a usable project slug from ${root}.\n`);
    return io.exit(EXIT_USER_RECOVERABLE);
  }

  const languages = await detectLanguages(root);
  const ides = await detectIDE();

  io.writeStdout(`${pc.green('✓')} Detected project root: ${root}\n`);
  if (languages.length > 0) {
    io.writeStdout(`${pc.green('✓')} Detected languages: ${languages.join(', ')}\n`);
  }
  if (ides.length > 0) {
    io.writeStdout(`${pc.green('✓')} Detected IDEs: ${ides.join(', ')}\n`);
  } else {
    io.writeStdout(`${pc.yellow('⚠')} No IDE config dir (~/.claude, ~/.cursor, ~/.windsurf) detected.\n`);
  }

  // Resolve and create ~/.contextos/{logs,pids} (data.db is created by openLocalDb).
  const contextosHome = resolveContextosHome({
    ...(options.home !== undefined ? { override: options.home } : {}),
    env,
  });
  if (!dryRun) {
    await mkdir(resolveContextosLogsDir(contextosHome), { recursive: true, mode: 0o700 });
    await mkdir(resolveContextosPidsDir(contextosHome), { recursive: true, mode: 0o700 });
  }
  io.writeStdout(`${pc.green('✓')} Resolved ContextOS home: ${contextosHome}\n`);

  // Apply migrations + seed F7 sentinel + register the user's project.
  const dataDb = `${contextosHome}/data.db`;
  if (!dryRun) {
    const handle = await openLocalDb(dataDb, { loadVecExtension: true });
    try {
      migrateSqlite(handle.db);
      await ensureGlobalProject(handle);
      const projectResult = await ensureProject(handle, { slug: projectSlug });
      io.writeStdout(
        `${pc.green('✓')} Applied migrations + seeded __global__ + registered project '${projectSlug}' ` +
          `(${projectResult.created ? 'new' : 'existing'} id ${projectResult.id})\n`,
      );
    } finally {
      handle.close();
    }
  } else {
    io.writeStdout(`${pc.yellow('⚠')} Dry run: skipping migrations + sentinel seed\n`);
  }

  // Locate the mcp-server binary if we're inside the dev monorepo.
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = await findRepoRoot(here);
  const mcpServerBin = repoRoot !== null ? `${repoRoot}/apps/mcp-server/dist/index.js` : null;

  const localHookSecret = randomBytes(32).toString('hex');
  const baselineEnv: BaselineEnv = {
    CONTEXTOS_MODE: 'solo',
    CLERK_SECRET_KEY: 'sk_test_replace_me',
    CLERK_PUBLISHABLE_KEY: 'pk_test_replace_me',
    LOCAL_HOOK_SECRET: localHookSecret,
    MCP_SERVER_PORT: '3100',
    HOOKS_BRIDGE_PORT: '3101',
  };

  const outcomes: WriteOutcome[] = [];

  // Write/merge .contextos.json
  outcomes.push(await writeContextosJson({ cwd: root, projectSlug, force, dryRun }));

  // Write/merge .mcp.json with the canonical contextos entry
  const mcpEntry = buildContextosMcpEntry({ mcpServerBin, clerkSecretKey: baselineEnv.CLERK_SECRET_KEY });
  outcomes.push(await mergeMcpJson({ cwd: root, entry: mcpEntry, force, dryRun }));

  // Write/merge .env with solo-mode sentinels
  outcomes.push(await mergeEnvFile({ cwd: root, baseline: baselineEnv, force, dryRun }));

  // Seed the feature pack folder
  const seedOutcomes = await seedFeaturePack({ cwd: root, slug: projectSlug, languages, force, dryRun });
  outcomes.push(...seedOutcomes);

  // Graphify is optional and out of 08a's required scope.
  if (options.graphify === false) {
    io.writeStdout(`${pc.yellow('⚠')} Skipping Graphify scan (--no-graphify)\n`);
  } else {
    io.writeStdout(
      `${pc.yellow('⚠')} Graphify scan not implemented in 08a — Feature Pack seeded with placeholder spec\n`,
    );
  }

  io.writeStdout('\n');
  for (const outcome of outcomes) {
    const glyph = actionGlyph(outcome.action);
    const note = outcome.notes !== undefined ? pc.gray(` (${outcome.notes})`) : '';
    io.writeStdout(`  ${glyph} ${outcome.path}${note}\n`);
  }

  io.writeStdout('\n');
  io.writeStdout(`${pc.green('ContextOS is ready')} (project '${projectSlug}').\n`);
  io.writeStdout('  → Restart your IDE so it picks up .mcp.json.\n');
  io.writeStdout('  → Run `contextos doctor` to verify the install.\n');
  io.writeStdout('  → Run `contextos start` to launch the MCP server + Hooks Bridge daemons.\n');

  if (dryRun) {
    io.writeStdout(`${pc.yellow('Note')}: --dry-run was set; no files were actually written.\n`);
  }

  // No critical reds during init under happy path. Future expansions (e.g.,
  // Graphify error) may surface EXIT_ENVIRONMENT_PROBLEM or
  // EXIT_USER_ACTION_REQUIRED; those constants are imported here so a future
  // slice doesn't have to re-thread them.
  void EXIT_ENVIRONMENT_PROBLEM;
  void EXIT_USER_ACTION_REQUIRED;
  return io.exit(EXIT_OK);
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function actionGlyph(action: string): string {
  switch (action) {
    case 'wrote':
      return pc.green('+');
    case 'merged':
      return pc.green('~');
    case 'forced':
      return pc.yellow('!');
    case 'unchanged':
      return pc.gray('=');
    default:
      return pc.gray('?');
  }
}
