import Link from 'next/link';

import { StatusChip } from '@/components/StatusChip';
import { resolveProjectFromParams } from '@/lib/project-context';
import { listPolicies } from '@/lib/queries/policies';

/**
 * `/projects/[slug]/policies` — server-rendered policy list, scoped
 * to the URL-bound project (M04 Phase 2 S2a IA migration).
 *
 * Cross-project filter dropdown is gone — switch projects via the
 * project switcher in HeaderNav (S2c).
 */

export const dynamic = 'force-dynamic';

export default async function PoliciesListPage({ params }: { params: Promise<{ slug: string }> }) {
  const project = await resolveProjectFromParams(params);
  const policies = await listPolicies(project.id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-black uppercase tracking-wide">Policies</h1>
        <p className="text-sm text-(--color-text-secondary)">
          Active rule sets evaluated by the bridge before every PreToolUse on{' '}
          <span className="font-mono">{project.slug}</span>.
        </p>
      </header>

      {policies.length === 0 ? (
        <EmptyState slug={project.slug} />
      ) : (
        <table className="w-full border border-(--color-border-subtle)">
          <thead className="bg-(--color-bg-elevated)">
            <tr>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Rules</Th>
              <Th>Updated</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id} className="border-b border-(--color-border-subtle) hover:bg-(--color-bg-surface)">
                <td className="px-3 py-3 font-mono text-sm font-medium text-(--color-text-code)">{policy.name}</td>
                <td className="px-3 py-3">
                  <StatusChip status={policy.isActive ? 'success' : 'neutral'}>
                    {policy.isActive ? 'active' : 'inactive'}
                  </StatusChip>
                </td>
                <td className="px-3 py-3 font-mono text-sm">{policy.rules.length}</td>
                <td className="px-3 py-3 font-mono text-xs text-(--color-text-tertiary)">
                  {policy.updatedAt.toISOString().slice(0, 19).replace('T', ' ')}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={
                      `/projects/${encodeURIComponent(project.slug)}/policies/${encodeURIComponent(policy.id)}` as never
                    }
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
        No policies on this project.
      </p>
      <p className="mt-2 text-sm text-(--color-text-tertiary)">
        Run <span className="font-mono">contextos init</span> in <span className="font-mono">{slug}</span> to seed the
        default policy set.
      </p>
    </div>
  );
}
