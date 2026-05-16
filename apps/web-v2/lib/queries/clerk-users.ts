import 'server-only';

/**
 * `apps/web-v2/lib/queries/clerk-users.ts` — batch-resolve Clerk user
 * ids to human display names (best-effort name → primary email →
 * shortened id fallback). Module 04 Phase 4 + the 2026-05-11 fix:
 * audit pages (runs / decisions / context-packs) carry
 * `created_by_user_id` strings that look like `user_2nKj…XYZ`; we
 * resolve them once per request and pass a `userId → label` map to
 * the `ActorBadge` component so end-users see e.g. "alice@acme.com"
 * instead of "user_2nKjY…6QH".
 *
 * Pattern:
 *   1. Caller collects the set of distinct Clerk user ids it needs
 *      (e.g., `new Set(rows.map(r => r.createdByUserId))`).
 *   2. Caller awaits `resolveClerkDisplayNames([...userIds])`.
 *   3. Caller passes the resulting `Map<string, string>` (or a plain
 *      record) to each ActorBadge as the `displayName` prop indexed
 *      by `userId`.
 *
 * Failure modes are silent: any user id we can't resolve (deleted
 * user, Clerk down, sentinel id `__solo__`) simply isn't in the map,
 * and ActorBadge falls back to its built-in shortened-id rendering.
 * We never throw — audit pages still render even when Clerk is down.
 *
 * Caching: requests are deduplicated within a single page render
 * via the input Set, but there's no cross-request cache yet. With
 * ~10–20 visible audit rows per page and Clerk's response under
 * 100ms, this is fine. A future enhancement would cache via React's
 * `cache()` for cross-component dedup within the same RSC render.
 */

const SENTINEL_USER_IDS: ReadonlySet<string> = new Set(['__solo__', '__global__']);

export interface ClerkUserDisplay {
  /** Preferred label: full name if set; else email; else shortened id. */
  readonly label: string;
  /** Always the email (primary or first available) when known; null otherwise. */
  readonly email: string | null;
}

/**
 * Resolve a set of Clerk user ids to display labels. Returns a Map
 * keyed by user id. Ids not found (or sentinels) are absent from the
 * map — caller should fall back gracefully.
 *
 * `userIds` is dedup-ed internally; pass a Set or an Array.
 */
export async function resolveClerkDisplayNames(
  userIds: Iterable<string | null | undefined>,
): Promise<Map<string, ClerkUserDisplay>> {
  const out = new Map<string, ClerkUserDisplay>();
  const realIds = new Set<string>();
  for (const id of userIds) {
    if (typeof id !== 'string') continue;
    if (id.length === 0) continue;
    if (SENTINEL_USER_IDS.has(id)) continue;
    if (!id.startsWith('user_')) continue; // safety: only real Clerk ids
    realIds.add(id);
  }
  if (realIds.size === 0) return out;

  let client: Awaited<ReturnType<typeof import('@clerk/nextjs/server').clerkClient>>;
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    client = await clerkClient();
  } catch {
    // Clerk not configured (solo deployment) — empty map, no-op.
    return out;
  }

  // Clerk's getUserList accepts `userId[]` (up to ~500 per call). For
  // our scale (a page typically has ≤ 20 distinct authors) one call is
  // always enough; we don't paginate.
  try {
    const list = await client.users.getUserList({
      userId: Array.from(realIds),
      limit: realIds.size,
    });
    for (const u of list.data) {
      const primaryEmail =
        u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        null;
      const fullName = [u.firstName, u.lastName]
        .filter((s) => typeof s === 'string' && s.length > 0)
        .join(' ')
        .trim();
      const label = fullName.length > 0 ? fullName : primaryEmail !== null ? primaryEmail : shortenUserId(u.id);
      out.set(u.id, { label, email: primaryEmail });
    }
  } catch {
    // Clerk API failed — return whatever we have (likely empty), no throw.
  }
  return out;
}

function shortenUserId(id: string): string {
  if (id.length <= 13) return id;
  return `${id.slice(0, 9)}…${id.slice(-3)}`;
}
