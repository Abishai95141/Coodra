/**
 * `apps/web-v2/components/ActorBadge.tsx` — render the author of an
 * audit row (decisions, context packs, runs, policies). Drives the
 * Module 04 Phase 4 "decided by" / "authored by" attribution surface.
 *
 * Three visual states:
 *
 *   1. `userId` is a real Clerk id (`user_…`) and matches the current
 *      viewer → "You" pill, accent-colored.
 *   2. `userId` is a real Clerk id and differs from the viewer →
 *      "user_2nKj…XYZ" pill, ink-colored.
 *   3. `userId` is null / `__solo__` → "—" placeholder, mute-colored.
 *
 * The component is a pure server-renderable atom — no client state, no
 * data fetching. Callers pass the optional `viewerUserId` so the "You"
 * branch fires correctly when the row is the viewer's own write.
 *
 * Why not resolve to display names via Clerk SDK here: that would
 * require a network round-trip per row, batched poorly, and would
 * change rendering semantics from server-pure to async. Instead the
 * page-level resolver (next iteration: `resolveClerkUsers([...userIds])`)
 * batch-resolves once and passes a `userId → name` map down to the
 * badge. For now the badge just shortens the id.
 */

interface ActorBadgeProps {
  /**
   * Clerk user id from `created_by_user_id`. NULL means "no attribution"
   * — solo-mode rows or pre-Phase-4 audit data. The badge renders an
   * em-dash for null.
   */
  readonly userId: string | null;
  /**
   * The currently-viewing user's clerk id, used to render "You" when
   * the row is the viewer's own write. Pass null in solo mode (every
   * "You" branch is suppressed).
   */
  readonly viewerUserId?: string | null;
  /**
   * Optional resolved display name (full name or email). When provided,
   * replaces the shortened id in the rendered label. Pass via a
   * page-level `userIdToName` map.
   */
  readonly displayName?: string;
  /** Visual size — defaults to `sm` (table-row sized). `xs` for badges in tight cells. */
  readonly size?: 'xs' | 'sm';
  /** Compact: emit just the avatar circle + collapsed text. Used in dense tables. */
  readonly compact?: boolean;
}

export function ActorBadge({ userId, viewerUserId, displayName, size = 'sm', compact = false }: ActorBadgeProps) {
  if (userId === null || userId === '__solo__') {
    return (
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontSize: size === 'xs' ? 9 : 10,
          color: 'var(--ink-mute)',
          letterSpacing: '0.04em',
        }}
      >
        —
      </span>
    );
  }

  const isYou = viewerUserId !== undefined && viewerUserId !== null && viewerUserId === userId;
  const label = isYou ? 'You' : (displayName ?? shortenUserId(userId));
  const initial = (isYou ? 'Y' : (displayName ?? userId).replace(/^(user_)?/, '').charAt(0)).toUpperCase();
  const fg = isYou ? 'var(--accent)' : 'var(--ink)';
  const bg = isYou ? 'var(--accent-glow)' : 'transparent';
  const border = isYou ? 'var(--accent)' : 'var(--rule-strong)';

  const dot = (
    <span
      style={{
        width: size === 'xs' ? 14 : 18,
        height: size === 'xs' ? 14 : 18,
        borderRadius: '50%',
        background: isYou ? 'var(--accent)' : 'var(--bg-3)',
        color: isYou ? 'var(--bg)' : 'var(--ink)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--mono)',
        fontSize: size === 'xs' ? 7 : 8,
        fontWeight: 600,
        flex: '0 0 auto',
      }}
    >
      {initial}
    </span>
  );

  if (compact) {
    return (
      <span
        title={`${label}${displayName !== undefined ? ` (${userId})` : ''}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: fg }}
      >
        {dot}
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: size === 'xs' ? 9 : 10,
            letterSpacing: '0.04em',
            color: fg,
          }}
        >
          {label}
        </span>
      </span>
    );
  }

  return (
    <span
      title={userId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 8px 3px 4px',
        border: `1px solid ${border}`,
        background: bg,
        fontFamily: 'var(--mono)',
        fontSize: size === 'xs' ? 9 : 10,
        letterSpacing: '0.06em',
        color: fg,
      }}
    >
      {dot}
      <span>{label}</span>
    </span>
  );
}

function shortenUserId(id: string): string {
  if (id.length <= 13) return id;
  return `${id.slice(0, 9)}…${id.slice(-3)}`;
}
