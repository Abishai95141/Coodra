'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * `apps/web/components/LogTailClient.tsx` — client subscriber for the
 * SSE log stream (M04 Phase 2 S11).
 *
 * Renders the initial server-fetched lines, then opens an EventSource
 * against `/api/projects/[slug]/logs/[service]/stream?fromOffset=…`.
 * New lines are appended to the bottom; the viewport auto-scrolls to
 * follow tail unless the user has scrolled up (sticky-tail toggle).
 *
 * Filter input does a case-insensitive substring match across visible
 * lines — purely client-side, doesn't change what the server sends.
 *
 * On EventSource errors the browser auto-reconnects per the SSE spec;
 * we surface a small "reconnecting…" badge while in that state.
 */

export interface LogTailClientProps {
  readonly slug: string;
  readonly service: string;
  readonly initialLines: ReadonlyArray<string>;
  readonly initialOffset: number;
}

const MAX_LINES = 5000;

export function LogTailClient({ slug, service, initialLines, initialOffset }: LogTailClientProps): React.JSX.Element {
  const [lines, setLines] = useState<ReadonlyArray<string>>(initialLines);
  const [filter, setFilter] = useState('');
  const [stickyTail, setStickyTail] = useState(true);
  const [status, setStatus] = useState<'live' | 'reconnecting' | 'closed'>('live');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = `/api/projects/${encodeURIComponent(slug)}/logs/${encodeURIComponent(service)}/stream?fromOffset=${initialOffset}`;
    const es = new EventSource(url);
    setStatus('live');

    es.addEventListener('lines', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { lines: string[] };
        if (Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          setLines((prev) => {
            const next = [...prev, ...parsed.lines];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        }
      } catch {
        // ignore malformed event
      }
    });
    es.addEventListener('error', () => {
      setStatus('reconnecting');
    });
    es.addEventListener('open', () => {
      setStatus('live');
    });

    return () => {
      es.close();
      setStatus('closed');
    };
  }, [slug, service, initialOffset]);

  // Auto-scroll on new lines when stickyTail is on. We trigger on
  // `lines.length` so a fresh batch of appended lines re-runs the
  // effect even though we don't read `lines` inside the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lines.length is the trigger; intentional dep
  useEffect(() => {
    if (!stickyTail) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, stickyTail]);

  const lf = filter.toLowerCase();
  const visible = lf.length === 0 ? lines : lines.filter((l) => l.toLowerCase().includes(lf));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter (substring, case-insensitive)"
            className="w-72 border border-(--color-border-default) bg-(--color-bg-base) px-2 py-1.5 font-mono text-sm"
          />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={stickyTail} onChange={(e) => setStickyTail(e.target.checked)} />
            <span className="font-display font-bold uppercase tracking-wider text-(--color-text-secondary)">
              Sticky tail
            </span>
          </label>
        </div>
        <StatusBadge status={status} count={lines.length} visible={visible.length} />
      </div>

      <div
        ref={containerRef}
        className="h-[60vh] overflow-y-auto overflow-x-auto border border-(--color-border-default) bg-(--color-bg-base) p-3 font-mono text-[11px] leading-snug text-(--color-text-primary)"
      >
        {visible.length === 0 ? (
          <p className="text-(--color-text-tertiary)">
            {lines.length === 0 ? 'No log lines yet — waiting for the service to write.' : 'No lines match the filter.'}
          </p>
        ) : (
          <pre className="whitespace-pre-wrap break-all">{visible.join('\n')}</pre>
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  count,
  visible,
}: {
  readonly status: 'live' | 'reconnecting' | 'closed';
  readonly count: number;
  readonly visible: number;
}): React.JSX.Element {
  const tone =
    status === 'live'
      ? 'bg-(--color-status-success)/15 text-(--color-status-success)'
      : status === 'reconnecting'
        ? 'bg-(--color-status-warning)/15 text-(--color-status-warning)'
        : 'bg-(--color-bg-elevated) text-(--color-text-tertiary)';
  return (
    <span className={`px-3 py-1 font-display text-xs font-bold uppercase tracking-wider ${tone}`}>
      ● {status} · {visible}/{count} lines
    </span>
  );
}
