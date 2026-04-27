import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type DbHandle, postgresSchema, sqliteSchema } from '@contextos/db';
import { createLogger } from '@contextos/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * `apps/hooks-bridge/src/lib/resolve-project-slug` — two-stage resolver:
 *   1. cwd → slug  (read `<cwd>/.contextos.json`)
 *   2. slug → projects.id  (DB lookup)
 *
 * Both stages are cached (60s) per-key. The policy evaluator filters
 * rules by `policies.project_id`, which is a foreign key into
 * `projects.id` (a UUID); the slug stored in `.contextos.json` and
 * referenced by tools is the human-readable lookup key. The hooks-
 * bridge pre-tool handler uses this resolver to bridge the gap.
 *
 * On any failure (file missing, schema mismatch, DB error, project
 * unregistered): returns undefined. The policy evaluator falls back
 * to the `__global__` cache slot, which loads the unfiltered union
 * of every project's rules. This is a soft-fail by design — the
 * policy still runs, just at a coarser scope.
 */

const projectSlugLogger = createLogger('hooks-bridge.resolve-project-slug');

const ContextosJsonSchema = z
  .object({
    projectSlug: z.string().min(1).optional(),
  })
  .passthrough();

interface SlugCacheEntry {
  readonly slug: string | undefined;
  readonly loadedAt: number;
}

interface IdCacheEntry {
  readonly projectId: string | undefined;
  readonly loadedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;

export interface CreateProjectResolverOptions {
  /** Cache TTL override (tests). */
  readonly cacheTtlMs?: number;
  /** Clock injection. */
  readonly now?: () => number;
}

export interface ProjectResolution {
  /** From `.contextos.json`. */
  readonly slug: string | undefined;
  /** From the projects table. Undefined if slug not registered. */
  readonly projectId: string | undefined;
}

export interface ProjectSlugResolver {
  /**
   * Returns `{ slug, projectId }` for the cwd. Both fields are
   * undefined when no `.contextos.json` is present; only `projectId`
   * is undefined when the slug is set but not yet registered as a
   * `projects` row.
   */
  resolve(cwd: string | undefined, db: DbHandle): Promise<ProjectResolution>;
  /** Test helper — drops both caches. */
  invalidate(): void;
}

export function createProjectSlugResolver(options: CreateProjectResolverOptions = {}): ProjectSlugResolver {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const slugCache = new Map<string, SlugCacheEntry>();
  const idCache = new Map<string, IdCacheEntry>();

  async function resolveSlug(cwd: string): Promise<string | undefined> {
    const cached = slugCache.get(cwd);
    if (cached && now() - cached.loadedAt < cacheTtlMs) return cached.slug;
    let slug: string | undefined;
    try {
      const raw = await readFile(join(cwd, '.contextos.json'), 'utf8');
      const parsed = ContextosJsonSchema.parse(JSON.parse(raw));
      slug = parsed.projectSlug;
    } catch (err) {
      projectSlugLogger.debug(
        { event: 'project_slug_unavailable', cwd, err: err instanceof Error ? err.message : String(err) },
        '.contextos.json not readable; using __global__ policy cache',
      );
      slug = undefined;
    }
    slugCache.set(cwd, { slug, loadedAt: now() });
    return slug;
  }

  async function resolveProjectId(slug: string, db: DbHandle): Promise<string | undefined> {
    const cached = idCache.get(slug);
    if (cached && now() - cached.loadedAt < cacheTtlMs) return cached.projectId;
    let projectId: string | undefined;
    try {
      if (db.kind === 'sqlite') {
        const rows = await db.db
          .select({ id: sqliteSchema.projects.id })
          .from(sqliteSchema.projects)
          .where(eq(sqliteSchema.projects.slug, slug))
          .limit(1);
        projectId = rows[0]?.id;
      } else {
        const rows = await db.db
          .select({ id: postgresSchema.projects.id })
          .from(postgresSchema.projects)
          .where(eq(postgresSchema.projects.slug, slug))
          .limit(1);
        projectId = rows[0]?.id;
      }
    } catch (err) {
      projectSlugLogger.warn(
        { event: 'project_id_lookup_failed', slug, err: err instanceof Error ? err.message : String(err) },
        'project id lookup threw; treating as not-registered',
      );
      projectId = undefined;
    }
    idCache.set(slug, { projectId, loadedAt: now() });
    return projectId;
  }

  return {
    async resolve(cwd, db) {
      if (cwd === undefined || cwd.length === 0) {
        return { slug: undefined, projectId: undefined };
      }
      const slug = await resolveSlug(cwd);
      if (slug === undefined) {
        return { slug: undefined, projectId: undefined };
      }
      const projectId = await resolveProjectId(slug, db);
      return { slug, projectId };
    },
    invalidate() {
      slugCache.clear();
      idCache.clear();
    },
  };
}
