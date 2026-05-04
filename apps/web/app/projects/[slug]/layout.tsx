import Link from 'next/link';

import { ProjectSubNav } from '@/components/ProjectSubNav';
import { ProjectsSwitcher } from '@/components/ProjectsSwitcher';
import { resolveProjectFromParams } from '@/lib/project-context';
import { fetchPickerSnapshot } from '@/lib/queries/picker';

/**
 * `apps/web/app/projects/[slug]/layout.tsx` — nested layout that
 * wraps every project-scoped page (M04 Phase 2 S2c hub-and-spoke
 * IA).
 *
 * Renders TWO things above the page content:
 *   1. A project-context bar — shows the active project name + a
 *      project switcher dropdown + a "Back to all projects" link.
 *   2. `<ProjectSubNav>` — secondary nav row (Home · Runs · Policies
 *      · Packs · Context Packs · Templates · Kill switches · Graph
 *      · Doctor · Logs · Settings) with the active section underlined.
 *
 * The workspace-level `<HeaderNav>` (rendered by the root layout)
 * stays above this — the user always sees the brand + workspace
 * actions, plus this project context layer when inside a project.
 */

export const dynamic = 'force-dynamic';

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const project = await resolveProjectFromParams(params);
  // Fetch the picker snapshot to populate the switcher dropdown +
  // status dot. Same query the `/` picker uses (force-dynamic so it's
  // always fresh).
  const picker = await fetchPickerSnapshot();
  const switcherOptions = picker.projects.map((p) => ({ slug: p.slug, statusDot: p.statusDot }));

  return (
    <div>
      <div className="border-b border-(--color-border-subtle) bg-(--color-bg-elevated)">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-8 py-3">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="font-display text-[10px] font-bold uppercase tracking-widest text-(--color-text-secondary) hover:text-(--color-brand)"
            >
              ◂ All projects
            </Link>
            <span className="font-display text-[10px] uppercase text-(--color-text-tertiary)">/</span>
            <span className="font-mono text-sm font-medium uppercase text-(--color-text-primary)">{project.slug}</span>
          </div>
          <ProjectsSwitcher currentSlug={project.slug} options={switcherOptions} />
        </div>
      </div>
      <ProjectSubNav projectSlug={project.slug} />
      <div className="mx-auto max-w-[1200px] px-8 py-8">{children}</div>
    </div>
  );
}
