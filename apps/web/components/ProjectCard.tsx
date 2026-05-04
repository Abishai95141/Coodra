import Link from 'next/link';

import { type ProjectStatusDotKind, StatusDot } from '@/components/StatusDot';
import { relativeTime } from '@/lib/format';

/**
 * `apps/web/components/ProjectCard.tsx` — project tile for the `/`
 * picker hub (M04 Phase 2 S2b).
 *
 * Whole card is a clickable Link to `/projects/[slug]`. Layout per
 * spec §7.3 sketch: name + status dot at top; 4 metrics in a strip;
 * last-activity + org footer.
 */

export interface ProjectCardProps {
  readonly slug: string;
  readonly name: string;
  readonly orgId: string;
  readonly activeRuns: number;
  readonly denials24h: number;
  readonly activeKillSwitches: number;
  readonly lastActivityAt: string | null; // ISO
  readonly statusDot: ProjectStatusDotKind;
}

export function ProjectCard(props: ProjectCardProps) {
  const lastActivityLabel =
    props.lastActivityAt === null ? 'No runs yet' : relativeTime(new Date(props.lastActivityAt));
  return (
    <Link
      href={`/projects/${encodeURIComponent(props.slug)}` as never}
      data-testid="project-card"
      data-slug={props.slug}
      className="group flex flex-col border border-(--color-border-subtle) bg-(--color-bg-surface) hover:border-(--color-brand)"
    >
      <div className="flex items-center gap-3 border-b border-(--color-border-subtle) px-6 py-4">
        <h3 className="font-mono text-base font-medium uppercase tracking-wider text-(--color-text-primary)">
          {props.slug}
        </h3>
        <span className="ml-auto inline-flex items-center gap-2">
          <StatusDot kind={props.statusDot} />
          <span className="font-display text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
            {props.statusDot}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-(--color-border-subtle) text-center">
        <Metric label="Active runs" value={props.activeRuns} tone={props.activeRuns > 0 ? 'info' : 'muted'} />
        <Metric label="Denials · 24h" value={props.denials24h} tone={props.denials24h > 0 ? 'error' : 'muted'} />
        <Metric
          label="Active pauses"
          value={props.activeKillSwitches}
          tone={props.activeKillSwitches > 0 ? 'warning' : 'muted'}
        />
      </div>
      <div className="flex items-center gap-2 border-t border-(--color-border-subtle) px-6 py-3 text-xs">
        <span className="text-(--color-text-secondary)">Last activity</span>
        <span className="font-mono text-(--color-text-primary)">{lastActivityLabel}</span>
        <span className="ml-auto font-mono text-[11px] text-(--color-text-tertiary)">{props.orgId}</span>
      </div>
    </Link>
  );
}

const TONE_TEXT: Record<'info' | 'warning' | 'error' | 'muted', string> = {
  info: 'text-(--color-status-info)',
  warning: 'text-(--color-status-warning)',
  error: 'text-(--color-status-error)',
  muted: 'text-(--color-text-tertiary)',
};

function Metric({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: 'info' | 'warning' | 'error' | 'muted';
}) {
  return (
    <div className="flex flex-col gap-1 bg-(--color-bg-surface) px-2 py-4">
      <div className={`font-display text-3xl font-black ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="font-display text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
        {label}
      </div>
    </div>
  );
}
