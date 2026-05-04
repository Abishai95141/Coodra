import Link from 'next/link';

import { RunRow } from '@/components/RunRow';
import { resolveProjectFromParams } from '@/lib/project-context';
import { listRuns } from '@/lib/queries/runs';

/**
 * `/projects/[slug]/runs` — server-rendered run list, scoped to the
 * URL-bound project (M04 Phase 2 S2a IA migration).
 *
 * URL state holds the secondary filter:
 *   ?status=in_progress|completed|cancelled|failed
 *   ?limit=<N>  (default 50; "Show more" link doubles)
 *
 * The previous cross-project `?project=` filter is gone — the URL
 * itself carries the project. To compare across projects, switch
 * via the project switcher in HeaderNav (S2c).
 */

export const dynamic = 'force-dynamic';

interface SearchParams {
  readonly status?: string;
  readonly limit?: string;
}

const STATUS_OPTIONS = ['', 'in_progress', 'completed', 'cancelled', 'failed'] as const;

export default async function RunsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const project = await resolveProjectFromParams(params);
  const sp = await searchParams;
  const limit = clampLimit(sp.limit);
  const filter = {
    projectId: project.id,
    ...(sp.status !== undefined && sp.status !== '' ? { status: sp.status } : {}),
    limit,
  };
  const { runs, hasMore } = await listRuns(filter);

  const baseHref = `/projects/${encodeURIComponent(project.slug)}/runs`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-black uppercase tracking-wide">Runs</h1>
        <p className="text-sm text-(--color-text-secondary)">
          {runs.length} run{runs.length === 1 ? '' : 's'} for <span className="font-mono">{project.slug}</span>, sorted
          by started_at descending.
        </p>
      </header>

      <form className="flex flex-wrap gap-4 border border-(--color-border-subtle) bg-(--color-bg-surface) p-4">
        <Filter
          label="Status"
          name="status"
          value={sp.status ?? ''}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s === '' ? 'All' : s }))}
        />
        <input type="hidden" name="limit" value={String(limit)} />
        <button
          type="submit"
          className="self-end bg-(--color-brand) px-4 py-2 font-display text-xs font-bold uppercase tracking-wider text-white hover:bg-(--color-brand-hover)"
        >
          Apply
        </button>
        {sp.status !== undefined && sp.status !== '' ? (
          <Link
            href={baseHref as never}
            className="self-end border border-(--color-border-default) px-4 py-2 font-display text-xs font-bold uppercase tracking-wider text-(--color-text-primary) hover:border-(--color-brand) hover:text-(--color-brand)"
          >
            Reset
          </Link>
        ) : null}
      </form>

      {runs.length === 0 ? (
        <EmptyState slug={project.slug} />
      ) : (
        <table className="w-full border border-(--color-border-subtle)">
          <thead className="bg-(--color-bg-elevated)">
            <tr>
              <Th>ID</Th>
              <Th>Status</Th>
              <Th>Agent</Th>
              <Th>Started</Th>
              <Th>Session</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <RunRow
                key={run.id}
                id={run.id}
                status={run.status}
                agentType={run.agentType}
                sessionId={run.sessionId}
                startedAt={run.startedAt}
                endedAt={run.endedAt}
                projectSlug={project.slug}
              />
            ))}
          </tbody>
        </table>
      )}

      {hasMore ? (
        <div className="self-center">
          <Link
            href={
              {
                pathname: baseHref,
                query: {
                  ...(sp.status !== undefined ? { status: sp.status } : {}),
                  limit: String(limit * 2),
                },
              } as never
            }
            className="font-display text-xs font-bold uppercase tracking-wider text-(--color-brand) hover:text-(--color-brand-hover)"
          >
            Show more ▸
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-display text-xs font-bold uppercase tracking-wider text-(--color-text-secondary)">
      {children}
    </th>
  );
}

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

function Filter({
  label,
  name,
  value,
  options,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<FilterOption>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-display text-xs font-bold uppercase tracking-wider text-(--color-text-secondary)">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="border border-(--color-border-default) bg-(--color-bg-base) px-3 py-2 font-sans text-sm text-(--color-text-primary)"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ slug }: { readonly slug: string }) {
  return (
    <div className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-12 text-center">
      <p className="font-display text-lg font-light uppercase tracking-wider text-(--color-text-secondary)">
        No runs in this project yet.
      </p>
      <p className="mt-2 text-sm text-(--color-text-tertiary)">
        Open Claude Code in <span className="font-mono">{slug}</span> to generate one.
      </p>
    </div>
  );
}

function clampLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '50', 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, 1000);
}
