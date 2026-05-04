'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type ProjectStatusDotKind, StatusDot } from '@/components/StatusDot';

/**
 * `apps/web/components/ProjectsSwitcher.tsx` — quick switch between
 * projects from inside a project (M04 Phase 2 S2c).
 *
 * Renders inside `apps/web/app/projects/[slug]/layout.tsx`'s header.
 * Native `<select>` (no JS combo-box library — operator-grade per
 * brand promise). On change, hard-navigates to the new project's
 * home.
 *
 * The list of available projects is passed in as a prop (the layout
 * fetches it once per render — same query the picker uses).
 */

export interface ProjectsSwitcherOption {
  readonly slug: string;
  readonly statusDot: ProjectStatusDotKind;
}

export interface ProjectsSwitcherProps {
  readonly currentSlug: string;
  readonly options: ReadonlyArray<ProjectsSwitcherOption>;
}

export function ProjectsSwitcher({ currentSlug, options }: ProjectsSwitcherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const current = options.find((o) => o.slug === currentSlug);

  return (
    <div className="flex items-center gap-3">
      {current !== undefined ? <StatusDot kind={current.statusDot} /> : null}
      <label className="flex items-center gap-2">
        <span className="font-display text-[10px] font-bold uppercase tracking-widest text-(--color-text-secondary)">
          Project
        </span>
        <select
          value={currentSlug}
          onChange={(e) => {
            const next = e.target.value;
            if (next === currentSlug) return;
            setPending(true);
            router.push(`/projects/${encodeURIComponent(next)}` as never);
          }}
          disabled={pending}
          className="border border-(--color-border-default) bg-(--color-bg-base) px-3 py-1.5 font-mono text-sm text-(--color-text-primary) hover:border-(--color-brand)"
        >
          {options.map((opt) => (
            <option key={opt.slug} value={opt.slug}>
              {opt.slug}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
