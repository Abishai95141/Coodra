/**
 * `apps/web/components/StatusDot.tsx` — small colored circle for
 * project status (M04 Phase 2 S2b picker hub).
 *
 * Maps the picker's heuristic status string to brand status palette
 * tokens. Renders inline so it can sit next to a project name.
 */

export type ProjectStatusDotKind = 'green' | 'amber' | 'red' | 'gray';

const COLOR_MAP: Record<ProjectStatusDotKind, { bg: string; ring: string }> = {
  green: {
    bg: 'bg-(--color-status-success)',
    ring: 'ring-(--color-status-success)/30',
  },
  amber: {
    bg: 'bg-(--color-status-warning)',
    ring: 'ring-(--color-status-warning)/30',
  },
  red: {
    bg: 'bg-(--color-status-error)',
    ring: 'ring-(--color-status-error)/30',
  },
  gray: {
    bg: 'bg-(--color-text-tertiary)',
    ring: 'ring-(--color-text-tertiary)/30',
  },
};

const LABEL_MAP: Record<ProjectStatusDotKind, string> = {
  green: 'active',
  amber: 'paused',
  red: 'denials in last 24h',
  gray: 'idle',
};

export function StatusDot({ kind }: { readonly kind: ProjectStatusDotKind }) {
  const { bg, ring } = COLOR_MAP[kind];
  return (
    <span
      data-testid="status-dot"
      data-kind={kind}
      title={LABEL_MAP[kind]}
      className={`inline-block h-2.5 w-2.5 ${bg} ring-2 ${ring}`}
    />
  );
}
