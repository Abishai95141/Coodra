import Link from 'next/link';

import { StatusChip } from '@/components/StatusChip';
import { resolveProjectFromParams } from '@/lib/project-context';
import { listPacks } from '@/lib/queries/packs';

/**
 * `/projects/[slug]/packs` — Feature packs scoped to the URL-bound
 * project (M04 Phase 2 S2a IA migration).
 *
 * Pack-to-project association: a pack belongs to project P if its
 * `slug == P.slug` (the init-created top-level pack) OR its
 * `parentSlug == P.slug` (sub-feature-packs that the project owns).
 * Packs not associated with any project are workspace-level packs
 * (e.g. ContextOS's own 01-foundation, 02-mcp-server) and live
 * elsewhere — out of S2a scope.
 */

export const dynamic = 'force-dynamic';

interface SearchParams {
  readonly deleted?: string;
}

export default async function PacksListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const project = await resolveProjectFromParams(params);
  const sp = await searchParams;
  const allPacks = listPacks();
  const packs = allPacks.filter((p) => p.slug === project.slug || p.parentSlug === project.slug);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-black uppercase tracking-wide">Feature packs</h1>
        <p className="text-sm text-(--color-text-secondary)">
          Packs owned by <span className="font-mono">{project.slug}</span> (slug or parent matches).
        </p>
      </header>

      {sp.deleted !== undefined ? (
        <div className="border-l-4 border-(--color-status-success) bg-(--color-status-success)/10 px-4 py-2 text-sm">
          ✓ Pack <span className="font-mono">{sp.deleted}</span> deleted (dir removed + is_active=false).
        </div>
      ) : null}

      {packs.length === 0 ? (
        <EmptyState slug={project.slug} />
      ) : (
        <table className="w-full border border-(--color-border-subtle)">
          <thead className="bg-(--color-bg-elevated)">
            <tr>
              <Th>Slug</Th>
              <Th>Parent</Th>
              <Th>Active</Th>
              <Th>Files</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {packs.map((p) => (
              <tr key={p.slug} className="border-b border-(--color-border-subtle) hover:bg-(--color-bg-surface)">
                <td className="px-3 py-3 font-mono text-sm font-medium text-(--color-text-code)">{p.slug}</td>
                <td className="px-3 py-3 font-mono text-xs text-(--color-text-tertiary)">{p.parentSlug ?? '—'}</td>
                <td className="px-3 py-3">
                  <StatusChip status={p.isActive ? 'success' : 'neutral'}>
                    {p.isActive ? 'active' : 'inactive'}
                  </StatusChip>
                </td>
                <td className="px-3 py-3 font-mono text-sm">
                  {p.fileCount}/4
                  {p.fileCount < 4 ? (
                    <span
                      className="ml-2 text-(--color-status-warning)"
                      title={`Missing: ${[
                        !p.hasMeta && 'meta.json',
                        !p.hasSpec && 'spec.md',
                        !p.hasImplementation && 'implementation.md',
                        !p.hasTechstack && 'techstack.md',
                      ]
                        .filter(Boolean)
                        .join(', ')}`}
                    >
                      ⚠
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/projects/${encodeURIComponent(project.slug)}/packs/${encodeURIComponent(p.slug)}` as never}
                    className="font-display text-xs font-bold uppercase tracking-wider text-(--color-brand) hover:text-(--color-brand-hover)"
                  >
                    View ▸
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

function EmptyState({ slug }: { readonly slug: string }) {
  return (
    <div className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-12 text-center">
      <p className="font-display text-lg font-light uppercase tracking-wider text-(--color-text-secondary)">
        No feature packs in this project.
      </p>
      <p className="mt-2 text-sm text-(--color-text-tertiary)">
        Run <span className="font-mono">contextos pack new &lt;slug&gt;</span> in{' '}
        <span className="font-mono">{slug}</span> to scaffold one.
      </p>
    </div>
  );
}
