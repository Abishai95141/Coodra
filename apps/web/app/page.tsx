import Link from 'next/link';

import { ProjectCard } from '@/components/ProjectCard';
import { fetchPickerSnapshot } from '@/lib/queries/picker';

/**
 * `/` — Project picker hub (M04 Phase 2 S2b — replaces the Phase 1
 * cross-project dashboard).
 *
 * Renders every registered project (excluding the `__global__`
 * sentinel) as a clickable `<ProjectCard>`. Each card shows per-
 * project tile counts + a status dot + last-activity timestamp.
 *
 * From here the operator picks a project; every operational surface
 * lives under `/projects/[slug]/...` per the hub-and-spoke IA.
 *
 * "+ Create project" CTA links to `/init` (S3 implements the wizard;
 * for now a placeholder redirect lives there).
 */

export const dynamic = 'force-dynamic';

export default async function ProjectPickerPage() {
  const snapshot = await fetchPickerSnapshot();
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-12 px-8 py-12">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-[56px] leading-[64px] font-black uppercase tracking-wide">Projects</h1>
          <Link
            href="/init"
            className="bg-(--color-brand) px-6 py-3 font-display text-xs font-bold uppercase tracking-wider text-white hover:bg-(--color-brand-hover)"
          >
            + New project
          </Link>
        </div>
        <p className="text-sm text-(--color-text-secondary)">
          {snapshot.projects.length} project{snapshot.projects.length === 1 ? '' : 's'} ·{' '}
          <span className="font-mono uppercase">{snapshot.mode}</span> mode · sorted by last activity.
        </p>
      </header>

      {snapshot.projects.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {snapshot.projects.map((p) => (
            <ProjectCard
              key={p.id}
              slug={p.slug}
              name={p.name}
              orgId={p.orgId}
              activeRuns={p.activeRuns}
              denials24h={p.denials24h}
              activeKillSwitches={p.activeKillSwitches}
              lastActivityAt={p.lastActivityAt}
              statusDot={p.statusDot}
            />
          ))}
        </section>
      )}

      <footer className="text-center text-xs text-(--color-text-tertiary)">
        Last refreshed {new Date(snapshot.fetchedAt).toLocaleTimeString()}
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-16 text-center">
      <div className="mx-auto mb-6 inline-flex h-16 w-16 items-center justify-center border-2 border-(--color-brand) text-3xl text-(--color-brand)">
        ◫
      </div>
      <h2 className="font-display text-xl font-bold uppercase tracking-wider text-(--color-text-primary)">
        No projects yet
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-(--color-text-secondary)">
        ContextOS organises everything around projects. Create one from the web wizard, or run{' '}
        <span className="font-mono">contextos init --project-slug X --no-graphify --ide claude</span> in a project root.
      </p>
      <Link
        href="/init"
        className="mt-6 inline-block bg-(--color-brand) px-6 py-3 font-display text-xs font-bold uppercase tracking-wider text-white hover:bg-(--color-brand-hover)"
      >
        + Create project
      </Link>
    </div>
  );
}
