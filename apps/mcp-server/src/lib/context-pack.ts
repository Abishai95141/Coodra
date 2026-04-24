import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type DbHandle, postgresSchema, sqliteSchema } from '@contextos/db';
import { EMBEDDING_DIM, type Logger, ValidationError } from '@contextos/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { ContextPackStore } from '../framework/tool-context.js';
import { createMcpLogger } from './logger.js';

/**
 * `apps/mcp-server/src/lib/context-pack.ts` — DB-first Context-Pack
 * store wired into `ToolContext.contextPack`.
 *
 * Write flow (user directive Q4: DB-first, FS reconcilable):
 *   1. Validate the `pack` payload with a module-local Zod schema.
 *   2. Compute `content_excerpt` = first 500 Unicode CODE POINTS of
 *      `content` with trailing whitespace trimmed (Q-02-3). Emoji
 *      and CJK at position 499 survive — covered by the unit test
 *      in `__tests__/unit/lib/context-pack-excerpt.test.ts`.
 *   3. Idempotency check: if a `context_packs` row already exists
 *      for `runId`, return that row's `{ id, createdAt,
 *      contentExcerpt }` without a second insert (§24.4).
 *   4. Insert the row. If an embedding was supplied, write the
 *      dialect-specific vector storage (vec0 virtual table for
 *      sqlite, `summary_embedding` vector column for postgres).
 *   5. Write the on-disk markdown file
 *      `docs/context-packs/YYYY-MM-DD-<runId-first-8>.md` as a
 *      materialised view (Q-02-4; fs is reconcilable from DB).
 *      A filesystem failure AFTER a successful DB insert logs at
 *      WARN and returns success — the row is durable and a future
 *      reconcile pass can replay the file.
 *
 * Embedding-dim assertion: non-null embeddings MUST be exactly
 * `@contextos/shared::EMBEDDING_DIM = 384`. A mismatch throws
 * `ValidationError` before any DB write.
 *
 * The store NEVER computes an embedding. Module 04 (NL Assembly)
 * owns embedding generation; Module 02 accepts whatever the caller
 * supplies, `Float32Array | null`.
 */

const contextPackLogger = createMcpLogger('lib-context-pack');

const EXCERPT_MAX_CODE_POINTS = 500 as const;

// ---------------------------------------------------------------------------
// Pack payload schema
// ---------------------------------------------------------------------------

const packSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  featurePackId: z.string().min(1).optional(),
});
export type ContextPackInput = z.infer<typeof packSchema>;

export interface ContextPackWriteResult {
  readonly id: string;
  readonly runId: string;
  readonly createdAt: Date;
  readonly contentExcerpt: string;
  readonly embeddingStored: boolean;
  readonly filePath: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Unicode code-point-safe excerpt. `String.prototype.slice(0, N)`
 * operates on UTF-16 code units and splits surrogate pairs mid-
 * character for emoji and supplementary-plane CJK. `Array.from`
 * iterates code points, so slicing the resulting array preserves
 * whole characters. Also trims trailing whitespace so a run of
 * newlines at the end doesn't poison LIKE search.
 */
export function computeContentExcerpt(content: string, max: number = EXCERPT_MAX_CODE_POINTS): string {
  if (typeof content !== 'string') return '';
  const chars = Array.from(content);
  const sliced = chars.length <= max ? chars : chars.slice(0, max);
  return sliced.join('').replace(/\s+$/u, '');
}

function defaultContextPacksRoot(): string {
  return resolve(process.cwd(), 'docs', 'context-packs');
}

function contextPackFilename(runId: string, createdAt: Date): string {
  const yyyyMmDd = createdAt.toISOString().slice(0, 10);
  const shortRun = runId.slice(0, 8);
  return `${yyyyMmDd}-${shortRun}.md`;
}

/** Embedding → SQLite-vec JSON-text form (per sqlite-vec 0.1.9 gotcha in the reference). */
function embeddingToSqliteVecText(embedding: Float32Array): string {
  const parts: string[] = new Array(embedding.length);
  for (let i = 0; i < embedding.length; i += 1) {
    parts[i] = String(embedding[i]);
  }
  return `[${parts.join(',')}]`;
}

function assertEmbeddingDim(embedding: Float32Array): void {
  if (embedding.length !== EMBEDDING_DIM) {
    throw new ValidationError(`context-pack.write: embedding length must be ${EMBEDDING_DIM}, got ${embedding.length}`);
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function selectByRunId(db: DbHandle, runId: string) {
  if (db.kind === 'sqlite') {
    const rows = await db.db
      .select()
      .from(sqliteSchema.contextPacks)
      .where(eq(sqliteSchema.contextPacks.runId, runId))
      .limit(1);
    return rows[0] ?? null;
  }
  const rows = await db.db
    .select()
    .from(postgresSchema.contextPacks)
    .where(eq(postgresSchema.contextPacks.runId, runId))
    .limit(1);
  return rows[0] ?? null;
}

async function insertRowAndEmbedding(
  db: DbHandle,
  row: {
    readonly id: string;
    readonly runId: string;
    readonly projectId: string;
    readonly title: string;
    readonly content: string;
    readonly contentExcerpt: string;
  },
  embedding: Float32Array | null,
): Promise<{ readonly createdAt: Date; readonly embeddingStored: boolean }> {
  if (db.kind === 'sqlite') {
    const baseRow = {
      id: row.id,
      runId: row.runId,
      projectId: row.projectId,
      title: row.title,
      content: row.content,
      contentExcerpt: row.contentExcerpt,
      summaryEmbedding: null as string | null,
    };
    const inserted = await db.db
      .insert(sqliteSchema.contextPacks)
      .values(baseRow)
      .returning({ id: sqliteSchema.contextPacks.id, createdAt: sqliteSchema.contextPacks.createdAt });
    const createdAt = inserted[0]?.createdAt ?? new Date();
    if (embedding !== null) {
      assertEmbeddingDim(embedding);
      const vecText = embeddingToSqliteVecText(embedding);
      // vec0 virtual table `context_packs_vec` is hand-written in
      // migration 0001 (sha256-locked). Insert via raw SQL because
      // Drizzle has no schema definition for virtual tables.
      db.raw.prepare('INSERT INTO context_packs_vec (context_pack_id, embedding) VALUES (?, ?)').run(row.id, vecText);
      return { createdAt, embeddingStored: true };
    }
    return { createdAt, embeddingStored: false };
  }
  // Postgres: `summary_embedding` is the vector column on the main
  // context_packs table (see packages/db/src/schema/postgres.ts).
  // Drizzle's pg-core doesn't own a vector type, so we go through
  // `sql` with a template literal cast.
  const values: Record<string, unknown> = {
    id: row.id,
    runId: row.runId,
    projectId: row.projectId,
    title: row.title,
    content: row.content,
    contentExcerpt: row.contentExcerpt,
  };
  let embeddingStored = false;
  if (embedding !== null) {
    assertEmbeddingDim(embedding);
    const literal = `[${Array.from(embedding).join(',')}]`;
    values.summaryEmbedding = sql`${literal}::vector(${EMBEDDING_DIM})`;
    embeddingStored = true;
  }
  const inserted = await db.db
    .insert(postgresSchema.contextPacks)
    .values(values as typeof postgresSchema.contextPacks.$inferInsert)
    .returning({ id: postgresSchema.contextPacks.id, createdAt: postgresSchema.contextPacks.createdAt });
  const createdAt = inserted[0]?.createdAt ?? new Date();
  return { createdAt, embeddingStored };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateContextPackStoreDeps {
  readonly db: DbHandle;
  /** Root for on-disk `YYYY-MM-DD-<runId>.md` files. Defaults to `${cwd}/docs/context-packs`. */
  readonly contextPacksRoot?: string;
  readonly logger?: Logger;
}

export function createContextPackStore(deps: CreateContextPackStoreDeps): ContextPackStore {
  if (!deps || typeof deps !== 'object') {
    throw new TypeError('createContextPackStore requires an options object');
  }
  if (!deps.db || typeof deps.db !== 'object' || !('kind' in deps.db)) {
    throw new TypeError('createContextPackStore: deps.db must be a DbHandle from @contextos/db');
  }
  const log = deps.logger ?? contextPackLogger;
  const contextPacksRoot = deps.contextPacksRoot ?? defaultContextPacksRoot();

  log.info(
    { event: 'context_pack_store_wired', contextPacksRoot },
    'createContextPackStore: DB-first store wired (FS is reconcilable).',
  );

  return {
    async write(pack, embedding) {
      const parsed = packSchema.safeParse(pack);
      if (!parsed.success) {
        throw new ValidationError(
          `context-pack.write: invalid pack payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
      const input = parsed.data;
      if (embedding !== null) {
        assertEmbeddingDim(embedding);
      }

      // Idempotency per runId (§24.4). Not a race-free guarantee —
      // the unique index on context_packs(run_id) is the enforcing
      // layer; this shortcut just avoids a second insert on retry.
      const existing = await selectByRunId(deps.db, input.runId);
      if (existing) {
        log.info(
          { event: 'context_pack_idempotent_hit', runId: input.runId, id: existing.id },
          'context-pack.write: row already exists for runId — returning existing shape',
        );
        const result: ContextPackWriteResult = {
          id: existing.id,
          runId: existing.runId,
          createdAt: existing.createdAt,
          contentExcerpt: existing.contentExcerpt,
          embeddingStored: existing.summaryEmbedding !== null,
          filePath: null,
        };
        return result;
      }

      const id = `cp_${randomUUID()}`;
      const contentExcerpt = computeContentExcerpt(input.content);
      const { createdAt, embeddingStored } = await insertRowAndEmbedding(
        deps.db,
        {
          id,
          runId: input.runId,
          projectId: input.projectId,
          title: input.title,
          content: input.content,
          contentExcerpt,
        },
        embedding,
      );

      // Materialise FS view. Failure is non-fatal — DB is source of truth.
      let filePath: string | null = null;
      try {
        await mkdir(contextPacksRoot, { recursive: true });
        const filename = contextPackFilename(input.runId, createdAt);
        const fullPath = resolve(contextPacksRoot, filename);
        await writeFile(fullPath, input.content, 'utf8');
        filePath = fullPath;
      } catch (err) {
        log.warn(
          {
            event: 'context_pack_fs_write_failed',
            runId: input.runId,
            contextPacksRoot,
            err: err instanceof Error ? err.message : String(err),
          },
          'context-pack.write: DB insert succeeded but FS materialise failed; row is durable, FS is reconcilable',
        );
      }

      const result: ContextPackWriteResult = {
        id,
        runId: input.runId,
        createdAt,
        contentExcerpt,
        embeddingStored,
        filePath,
      };
      return result;
    },

    async read(runId) {
      if (typeof runId !== 'string' || runId.length === 0) {
        throw new ValidationError('context-pack.read: runId is required');
      }
      const row = await selectByRunId(deps.db, runId);
      if (!row) return null;
      return row;
    },

    async list(filter) {
      const limit = typeof filter.limit === 'number' && filter.limit > 0 ? Math.min(filter.limit, 200) : 50;
      if (deps.db.kind === 'sqlite') {
        const cp = sqliteSchema.contextPacks;
        const conditions = [];
        if (filter.runId) conditions.push(eq(cp.runId, filter.runId));
        if (filter.projectSlug) {
          const projectRows = await deps.db.db
            .select({ id: sqliteSchema.projects.id })
            .from(sqliteSchema.projects)
            .where(eq(sqliteSchema.projects.slug, filter.projectSlug))
            .limit(1);
          const projectId = projectRows[0]?.id;
          if (!projectId) return [];
          conditions.push(eq(cp.projectId, projectId));
        }
        const where =
          conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
        const rows = await (where
          ? deps.db.db.select().from(cp).where(where).orderBy(desc(cp.createdAt)).limit(limit)
          : deps.db.db.select().from(cp).orderBy(desc(cp.createdAt)).limit(limit));
        return rows;
      }
      const cp = postgresSchema.contextPacks;
      const conditions = [];
      if (filter.runId) conditions.push(eq(cp.runId, filter.runId));
      if (filter.projectSlug) {
        const projectRows = await deps.db.db
          .select({ id: postgresSchema.projects.id })
          .from(postgresSchema.projects)
          .where(eq(postgresSchema.projects.slug, filter.projectSlug))
          .limit(1);
        const projectId = projectRows[0]?.id;
        if (!projectId) return [];
        conditions.push(eq(cp.projectId, projectId));
      }
      const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
      const rows = await (where
        ? deps.db.db.select().from(cp).where(where).orderBy(desc(cp.createdAt)).limit(limit)
        : deps.db.db.select().from(cp).orderBy(desc(cp.createdAt)).limit(limit));
      return rows;
    },
  };
}
