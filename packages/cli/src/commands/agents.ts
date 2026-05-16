import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EXIT_OK } from '../exit-codes.js';
import { defaultClaudeSettingsPath } from '../lib/init/claude-settings-merge.js';
import { INSTRUCTION_BLOCK_START } from '../lib/init/instruction-files.js';
import { defaultWindsurfMcpConfigPath } from '../lib/init/windsurf-merge.js';
import { pc } from '../ui/compat.js';
import { commandTitle, hintLine, type KvRow, kvBlock, sectionHead, terminalWidth } from '../ui/index.js';

/**
 * `coodra agents` — read-only status surface for the multi-agent wiring.
 *
 * Lists each supported agent (Claude Code, Cursor, Windsurf, Codex)
 * with a per-file status:
 *   ✓ wired   — file exists AND contains a managed coodra entry/block
 *   ◌ partial — file exists but no coodra entry/block (or vice versa)
 *   ✗ missing — file does not exist
 *
 * Companion to `coodra init` (which writes the files) and
 * `coodra uninstall` (which removes them). The TUI's /02 catalog picks
 * up this command automatically.
 */

export interface AgentsOptions {
  readonly json?: boolean;
  readonly cwd?: string;
  readonly userHome?: string;
}

export interface AgentsIO {
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
  readonly exit: (code: number) => never;
}

export const DEFAULT_AGENTS_IO: AgentsIO = {
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

type AgentName = 'claude' | 'cursor' | 'windsurf' | 'codex';

export interface AgentFileState {
  /** Display name of the file (`.mcp.json`, `~/.claude/settings.json`, etc.). */
  readonly label: string;
  /** Absolute path on disk. */
  readonly path: string;
  /** Whether the file exists. */
  readonly exists: boolean;
  /** Whether the file carries the managed coodra entry/block. */
  readonly wired: boolean;
  /** Short note explaining the status. */
  readonly notes: string;
}

export interface AgentReport {
  readonly name: AgentName;
  readonly displayName: string;
  readonly detected: boolean;
  /** Path to the IDE config dir we use for detection. */
  readonly detectionPath: string;
  readonly files: readonly AgentFileState[];
  /** Short note rendered after the files block. */
  readonly howToEnable: string | null;
}

export async function runAgentsCommand(options: AgentsOptions = {}, io: AgentsIO = DEFAULT_AGENTS_IO): Promise<never> {
  const cwd = options.cwd ?? process.cwd();
  const userHome = options.userHome ?? homedir();
  const reports = await buildAgentReports({ cwd, userHome });

  if (options.json === true) {
    io.writeStdout(`${JSON.stringify(reports, null, 2)}\n`);
    return io.exit(EXIT_OK);
  }

  io.writeStdout(`${commandTitle('Agents', 'Coodra wiring', { width: terminalWidth(), indent: 0 })}\n`);
  io.writeStdout('\n');
  reports.forEach((report, idx) => {
    renderAgent(report, idx + 1, io);
    io.writeStdout('\n');
  });
  io.writeStdout(hintLine('Run `coodra init` to wire detected agents, `coodra uninstall` to strip Coodra files.'));
  io.writeStdout('\n');
  return io.exit(EXIT_OK);
}

function renderAgent(report: AgentReport, slot: number, io: AgentsIO): void {
  const slotNum = String(slot).padStart(2, '0');
  const detectionTone = report.detected ? pc.green('✓') : pc.gray('✗');
  io.writeStdout(`${sectionHead(slotNum, report.displayName)}\n`);
  io.writeStdout(
    `  ${detectionTone} ${report.detectionPath}  ${pc.gray(report.detected ? '(detected)' : '(not installed)')}\n`,
  );
  const rows: KvRow[] = report.files.map((file) => ({
    key: `${fileGlyph(file)} ${file.label}`,
    value: file.notes,
    valueTone: file.wired ? 'phosphor' : file.exists ? 'amber' : 'inkFar',
  }));
  if (rows.length > 0) {
    // 42-col key gives `~/.codeium/windsurf/mcp_config.json` (the
    // longest label) breathing room before the value column starts.
    io.writeStdout(`${kvBlock(rows, { keyWidth: 42, indent: 2 })}\n`);
  }
  if (report.howToEnable !== null) {
    io.writeStdout(`  ${pc.gray(`→ ${report.howToEnable}`)}\n`);
  }
}

function fileGlyph(file: AgentFileState): string {
  if (file.wired) return pc.green('✓');
  if (file.exists) return pc.yellow('◌');
  return pc.gray('✗');
}

export interface BuildReportsInput {
  readonly cwd: string;
  readonly userHome: string;
}

export async function buildAgentReports(input: BuildReportsInput): Promise<readonly AgentReport[]> {
  return [await claudeReport(input), await cursorReport(input), await windsurfReport(input), await codexReport(input)];
}

async function claudeReport(input: BuildReportsInput): Promise<AgentReport> {
  const claudeDir = join(input.userHome, '.claude');
  const detected = await pathExists(claudeDir);
  const settingsPath = defaultClaudeSettingsPath(input.userHome);
  const mcpPath = join(input.cwd, '.mcp.json');
  const claudeMd = join(input.cwd, 'CLAUDE.md');
  return {
    name: 'claude',
    displayName: 'Claude Code',
    detected,
    detectionPath: `${claudeDir}/`,
    files: [
      await mcpJsonState({ path: mcpPath, label: '.mcp.json' }),
      await settingsJsonState({ path: settingsPath, label: '~/.claude/settings.json' }),
      await instructionFileState({ path: claudeMd, label: 'CLAUDE.md' }),
    ],
    howToEnable: detected
      ? null
      : 'Install Claude Code (claude.ai/code), then run `coodra init` (or `coodra init --ide claude`).',
  };
}

async function cursorReport(input: BuildReportsInput): Promise<AgentReport> {
  const cursorDir = join(input.userHome, '.cursor');
  const detected = await pathExists(cursorDir);
  return {
    name: 'cursor',
    displayName: 'Cursor',
    detected,
    detectionPath: `${cursorDir}/`,
    files: [
      await mcpJsonState({ path: join(input.cwd, '.cursor', 'mcp.json'), label: '.cursor/mcp.json' }),
      await instructionFileState({ path: join(input.cwd, '.cursorrules'), label: '.cursorrules' }),
    ],
    howToEnable: detected
      ? null
      : 'Install Cursor (cursor.com), then run `coodra init` (or `coodra init --ide cursor`).',
  };
}

async function windsurfReport(input: BuildReportsInput): Promise<AgentReport> {
  const windsurfDir = join(input.userHome, '.windsurf');
  const detected = await pathExists(windsurfDir);
  return {
    name: 'windsurf',
    displayName: 'Windsurf',
    detected,
    detectionPath: `${windsurfDir}/`,
    files: [
      await mcpJsonState({
        path: defaultWindsurfMcpConfigPath(input.userHome),
        label: '~/.codeium/windsurf/mcp_config.json',
      }),
      await instructionFileState({ path: join(input.cwd, '.windsurfrules'), label: '.windsurfrules' }),
    ],
    howToEnable: detected
      ? null
      : 'Install Windsurf (codeium.com/windsurf), then run `coodra init` (or `coodra init --ide windsurf`).',
  };
}

async function codexReport(input: BuildReportsInput): Promise<AgentReport> {
  const codexDir = join(input.userHome, '.codex');
  const detected = await pathExists(codexDir);
  return {
    name: 'codex',
    displayName: 'Codex',
    detected,
    detectionPath: `${codexDir}/`,
    files: [
      await codexConfigState({ path: join(input.cwd, '.codex', 'config.toml'), label: '.codex/config.toml' }),
      await instructionFileState({ path: join(input.cwd, 'AGENTS.md'), label: 'AGENTS.md' }),
    ],
    howToEnable: detected
      ? null
      : 'Install Codex CLI (github.com/openai/codex), then run `coodra init` (or `coodra init --ide codex`).',
  };
}

interface FileLabelInput {
  readonly path: string;
  readonly label: string;
}

async function mcpJsonState(input: FileLabelInput): Promise<AgentFileState> {
  const exists = await pathExists(input.path);
  if (!exists) {
    return {
      label: input.label,
      path: input.path,
      exists: false,
      wired: false,
      notes: 'missing',
    };
  }
  try {
    const raw = await readFile(input.path, 'utf8');
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const wired = parsed.mcpServers !== undefined && Object.hasOwn(parsed.mcpServers, 'coodra');
    return {
      label: input.label,
      path: input.path,
      exists: true,
      wired,
      notes: wired ? 'coodra MCP entry present' : 'no coodra entry — run `coodra init`',
    };
  } catch {
    return { label: input.label, path: input.path, exists: true, wired: false, notes: 'unreadable JSON' };
  }
}

async function settingsJsonState(input: FileLabelInput): Promise<AgentFileState> {
  const exists = await pathExists(input.path);
  if (!exists) {
    return { label: input.label, path: input.path, exists: false, wired: false, notes: 'missing — hooks not wired' };
  }
  try {
    const raw = await readFile(input.path, 'utf8');
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    const hooks = parsed.hooks ?? {};
    const bridgeUrlPart = '/v1/hooks/claude-code';
    const wired = JSON.stringify(hooks).includes(bridgeUrlPart);
    return {
      label: input.label,
      path: input.path,
      exists: true,
      wired,
      notes: wired
        ? 'coodra hooks wired (SessionStart, Pre/PostToolUse, Stop, SessionEnd)'
        : 'no coodra hooks — run `coodra init`',
    };
  } catch {
    return { label: input.label, path: input.path, exists: true, wired: false, notes: 'unreadable JSON' };
  }
}

async function codexConfigState(input: FileLabelInput): Promise<AgentFileState> {
  const exists = await pathExists(input.path);
  if (!exists) {
    return { label: input.label, path: input.path, exists: false, wired: false, notes: 'missing' };
  }
  try {
    const raw = await readFile(input.path, 'utf8');
    const wired = /\[mcp_servers\.coodra\]/.test(raw);
    return {
      label: input.label,
      path: input.path,
      exists: true,
      wired,
      notes: wired ? 'coodra MCP entry present' : 'no coodra entry — run `coodra init`',
    };
  } catch {
    return { label: input.label, path: input.path, exists: true, wired: false, notes: 'unreadable TOML' };
  }
}

async function instructionFileState(input: FileLabelInput): Promise<AgentFileState> {
  const exists = await pathExists(input.path);
  if (!exists) {
    return { label: input.label, path: input.path, exists: false, wired: false, notes: 'missing' };
  }
  try {
    const raw = await readFile(input.path, 'utf8');
    const wired = raw.includes(INSTRUCTION_BLOCK_START);
    return {
      label: input.label,
      path: input.path,
      exists: true,
      wired,
      notes: wired ? 'coodra block present' : 'no coodra block — run `coodra init`',
    };
  } catch {
    return { label: input.label, path: input.path, exists: true, wired: false, notes: 'unreadable file' };
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
