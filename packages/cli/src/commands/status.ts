import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import pc from 'picocolors';
import { EXIT_OK, EXIT_USER_ACTION_REQUIRED, EXIT_USER_RECOVERABLE } from '../exit-codes.js';
import { resolveContextosHome } from '../lib/contextos-home.js';
import { openLocalDb } from '../lib/open-local-db.js';
import { SERVICES } from '../lib/services.js';

export interface StatusOptions {
  readonly json?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly home?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface StatusIO {
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
  readonly exit: (code: number) => never;
}

export const DEFAULT_STATUS_IO: StatusIO = {
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

export interface ProjectState {
  readonly slug: string | null;
  readonly registered: boolean;
  readonly projectId: string | null;
  readonly cwd: string;
  readonly mode: string;
  readonly notes: string[];
}

export interface ServiceState {
  readonly name: string;
  readonly displayName: string;
  readonly state: 'running' | 'stopped' | 'unknown';
  readonly port: number;
  readonly url: string;
}

export interface RecentState {
  readonly lastRun: { id: string; status: string; startedAt: string; agentType: string } | null;
  readonly lastDecision: { description: string; createdAt: string } | null;
  readonly blockerNote: string | null;
}

export interface StatusReport {
  readonly project: ProjectState;
  readonly services: ServiceState[];
  readonly recent: RecentState;
  readonly contextosHome: string;
}

export async function runStatusCommand(options: StatusOptions = {}, io: StatusIO = DEFAULT_STATUS_IO): Promise<never> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const contextosHome = resolveContextosHome({
    ...(options.home !== undefined ? { override: options.home } : {}),
    env,
  });
  const fetchImpl = options.fetchImpl ?? fetch;

  const project = await collectProjectState(cwd, contextosHome, env);
  const services = await collectServiceStates(env, fetchImpl);
  const recent = await collectRecentState(contextosHome, project.projectId);

  const report: StatusReport = { project, services, recent, contextosHome };

  if (options.json === true) {
    io.writeStdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.writeStdout(formatHumanReport(report));
  }

  const exit = decideExit(report);
  return io.exit(exit);
}

async function collectProjectState(cwd: string, _contextosHome: string, env: NodeJS.ProcessEnv): Promise<ProjectState> {
  const configPath = join(cwd, '.contextos.json');
  const notes: string[] = [];
  let slug: string | null = null;
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { projectSlug?: unknown };
    if (typeof parsed.projectSlug === 'string') slug = parsed.projectSlug;
  } catch {
    notes.push('.contextos.json missing — bridge will fall back to __global__ for this cwd');
  }
  const mode = typeof env.CONTEXTOS_MODE === 'string' && env.CONTEXTOS_MODE.length > 0 ? env.CONTEXTOS_MODE : 'solo';
  return { slug, registered: false, projectId: null, cwd, mode, notes };
}

async function collectServiceStates(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<ServiceState[]> {
  const mcpPort = parsePort(env.MCP_SERVER_PORT, 3100);
  const bridgePort = parsePort(env.HOOKS_BRIDGE_PORT, 3101);

  const states: ServiceState[] = [];
  for (const descriptor of SERVICES) {
    const port = descriptor.name === 'mcp-server' ? mcpPort : bridgePort;
    const url = descriptor.healthUrl(port);
    let state: ServiceState['state'] = 'stopped';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetchImpl(url, { signal: controller.signal });
      clearTimeout(timeout);
      state = response.ok ? 'running' : 'unknown';
    } catch {
      state = 'stopped';
    }
    states.push({ name: descriptor.name, displayName: descriptor.displayName, state, port, url });
  }
  return states;
}

async function collectRecentState(contextosHome: string, projectId: string | null): Promise<RecentState> {
  const dataDb = join(contextosHome, 'data.db');
  let dbExists = true;
  try {
    await access(dataDb);
  } catch {
    dbExists = false;
  }
  if (!dbExists) {
    return { lastRun: null, lastDecision: null, blockerNote: null };
  }

  let handle: Awaited<ReturnType<typeof openLocalDb>>;
  try {
    handle = await openLocalDb(dataDb);
  } catch {
    return { lastRun: null, lastDecision: null, blockerNote: null };
  }
  try {
    const runRow = (() => {
      try {
        const row = handle.raw
          .prepare(
            `SELECT id, status, started_at, agent_type FROM runs ${
              projectId !== null ? 'WHERE project_id = ?' : ''
            } ORDER BY started_at DESC LIMIT 1`,
          )
          .get(...(projectId !== null ? [projectId] : [])) as
          | { id: string; status: string; started_at: number; agent_type: string }
          | undefined;
        if (row === undefined) return null;
        return {
          id: row.id,
          status: row.status,
          startedAt: new Date(row.started_at * 1000).toISOString(),
          agentType: row.agent_type,
        };
      } catch {
        return null;
      }
    })();

    const decisionRow = (() => {
      try {
        const row = handle.raw
          .prepare(`SELECT description, created_at FROM decisions ORDER BY created_at DESC LIMIT 1`)
          .get() as { description: string; created_at: number } | undefined;
        if (row === undefined) return null;
        return {
          description: row.description,
          createdAt: new Date(row.created_at * 1000).toISOString(),
        };
      } catch {
        return null;
      }
    })();

    let blockerNote: string | null = null;
    try {
      const blockersPath = join(process.cwd(), 'context_memory', 'blockers.md');
      const stats = await stat(blockersPath);
      if (stats.size > 0) {
        const raw = await readFile(blockersPath, 'utf8');
        if (raw.trim().length > 0) blockerNote = `${raw.trim().slice(0, 80)}…`;
      }
    } catch {
      /* no blockers file */
    }

    return { lastRun: runRow, lastDecision: decisionRow, blockerNote };
  } finally {
    handle.close();
  }
}

function formatHumanReport(report: StatusReport): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Project')}     ${report.project.slug ?? pc.yellow('(unregistered)')}`);
  if (report.project.notes.length > 0) {
    for (const note of report.project.notes) lines.push(`            ${pc.yellow('⚠')} ${note}`);
  }
  lines.push(`${pc.bold('Cwd')}         ${report.project.cwd}`);
  lines.push(`${pc.bold('Mode')}        ${report.project.mode}`);
  lines.push('');
  lines.push(pc.bold('Services'));
  for (const service of report.services) {
    const glyph =
      service.state === 'running' ? pc.green('✓') : service.state === 'stopped' ? pc.red('✗') : pc.yellow('⚠');
    lines.push(
      `  ${glyph} ${service.displayName.padEnd(28)} ${service.state}  :${service.port}  ${pc.gray(service.url)}`,
    );
  }
  lines.push('');
  lines.push(pc.bold('Recent'));
  if (report.recent.lastRun !== null) {
    const r = report.recent.lastRun;
    lines.push(`  Last run         ${r.startedAt}  status=${r.status}  agent=${r.agentType}`);
  } else {
    lines.push(`  Last run         (none)`);
  }
  if (report.recent.lastDecision !== null) {
    const d = report.recent.lastDecision;
    lines.push(`  Last decision    ${d.createdAt}  "${d.description.slice(0, 60)}"`);
  } else {
    lines.push(`  Last decision    (none)`);
  }
  if (report.recent.blockerNote !== null) {
    lines.push(`  Pending blocker  ${pc.yellow(report.recent.blockerNote)}`);
  } else {
    lines.push(`  Pending blocker  ${pc.green('context_memory/blockers.md is empty ✓')}`);
  }
  lines.push('');
  lines.push(`Run \`contextos doctor\` for the full diagnostic.`);
  return `${lines.join('\n')}\n`;
}

function decideExit(report: StatusReport): 0 | 1 | 2 {
  const allDown = report.services.every((s) => s.state === 'stopped');
  if (allDown) return EXIT_USER_ACTION_REQUIRED as 2;
  const someDown = report.services.some((s) => s.state !== 'running');
  const unregistered = !report.project.registered && report.project.slug === null;
  if (someDown || unregistered) return EXIT_USER_RECOVERABLE as 1;
  return EXIT_OK as 0;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return fallback;
  return parsed;
}
