import { existsSync, statSync } from 'node:fs';

import Link from 'next/link';

import { LOG_SERVICES, type LogService, logPathFor } from '@/lib/log-tail';
import { resolveProjectFromParams } from '@/lib/project-context';

/**
 * `/projects/[slug]/logs` — log service picker (M04 Phase 2 S11).
 *
 * Lists the three workspace log files (hooks-bridge, mcp-server,
 * sync-daemon) with size + last-modified info, and links to the
 * per-service tail surface at `/projects/[slug]/logs/[service]`.
 */

export const dynamic = 'force-dynamic';

export default async function LogsIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const project = await resolveProjectFromParams(params);
  const baseHref = `/projects/${encodeURIComponent(project.slug)}/logs`;
  const rows = LOG_SERVICES.map((s) => describe(s));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-black uppercase tracking-wide text-(--color-text-primary)">Logs</h1>
        <p className="text-sm text-(--color-text-secondary)">
          Workspace-grain log files (one per ContextOS service). Tailed live via Server-Sent Events.
        </p>
      </header>

      <table className="w-full border border-(--color-border-subtle)">
        <thead className="bg-(--color-bg-elevated)">
          <tr>
            <Th>Service</Th>
            <Th>Path</Th>
            <Th>Size</Th>
            <Th>Last modified</Th>
            <Th>Open</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.service} className="border-b border-(--color-border-subtle) hover:bg-(--color-bg-surface)">
              <td className="px-3 py-3 font-mono text-sm text-(--color-text-primary)">{r.service}</td>
              <td className="px-3 py-3 font-mono text-xs text-(--color-text-tertiary)">{r.path}</td>
              <td className="px-3 py-3 font-mono text-xs text-(--color-text-secondary)">
                {r.exists ? formatBytes(r.size) : '—'}
              </td>
              <td className="px-3 py-3 font-mono text-xs text-(--color-text-tertiary)">
                {r.exists ? r.mtime.toISOString() : 'not present'}
              </td>
              <td className="px-3 py-3">
                <Link
                  href={`${baseHref}/${r.service}` as never}
                  className="font-display text-xs font-bold uppercase tracking-wider text-(--color-brand) hover:text-(--color-brand-hover)"
                >
                  Tail ▸
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function describe(service: LogService) {
  const path = logPathFor(service);
  if (!existsSync(path)) {
    return { service, path, exists: false as const, size: 0, mtime: new Date(0) };
  }
  try {
    const s = statSync(path);
    return { service, path, exists: true as const, size: s.size, mtime: new Date(s.mtimeMs) };
  } catch {
    return { service, path, exists: false as const, size: 0, mtime: new Date(0) };
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-display text-xs font-bold uppercase tracking-wider text-(--color-text-secondary)">
      {children}
    </th>
  );
}
