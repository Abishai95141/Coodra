import { describe, expect, it } from 'vitest';

/**
 * M04 Phase 2 S1 — F1 guard.
 *
 * Asserts that every Server-Component page that reads mutable state
 * (DB or filesystem) declares `export const dynamic = 'force-dynamic'`.
 * Without this, Next.js 15 prerenders the route at build time and the
 * served HTML reflects the build-time DB / filesystem snapshot — the
 * 2026-05-04 audit caught the dashboard rendering `Active runs: 3 /
 * Denials: 546` against an empty post-purge DB because of this.
 *
 * This test loads each route module and reads the named export. It
 * fails fast if a future commit drops the directive.
 */

// 30s per-test timeout because dynamic-import of the page modules cold-starts
// the entire query/action graph (db, drizzle, ensureProject, etc.). Under
// turbo's parallel runner the default 5s window flakes — apps/web is the
// deprecated shell, so we keep the assertion but stop pretending it's a
// hot-path unit test. (Vitest 4 removed the `describe(name, fn, options)`
// signature; per-test option-objects are now the way to bump timeout.)
describe('M04 Phase 2 S1 — F1 force-dynamic guards on data-reading routes (post-S2a IA migration)', () => {
  it('/ (project picker / will be picker after S2b — placeholder home now) declares dynamic = "force-dynamic"', {
    timeout: 30000,
  }, async () => {
    const mod = await import('@/app/page');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('/projects/[slug]/packs declares dynamic = "force-dynamic"', { timeout: 30000 }, async () => {
    const mod = await import('@/app/projects/[slug]/packs/page');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('/projects/[slug]/packs/[packSlug] declares dynamic = "force-dynamic"', { timeout: 30000 }, async () => {
    const mod = await import('@/app/projects/[slug]/packs/[packSlug]/page');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('/projects/[slug]/templates declares dynamic = "force-dynamic"', { timeout: 30000 }, async () => {
    const mod = await import('@/app/projects/[slug]/templates/page');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
