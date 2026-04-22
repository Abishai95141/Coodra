import { type Column, getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as pg from '../../src/schema/postgres.js';
import * as sq from '../../src/schema/sqlite.js';

/**
 * Schema-parity CI test (per decision Q7 of the user-approved bootstrap plan).
 *
 * This file fails the build if the SQLite and Postgres dialects drift on:
 *   - the set of tables (5-table core)
 *   - column names per table
 *   - notNull flags per column
 *
 * Intentional dialect-specific columns (currently: `context_packs.summary_embedding`
 * is TEXT in SQLite vs VECTOR(384) in Postgres — sqlite-vec binding is Module 02
 * per `docs/feature-packs/01-foundation/spec.md` §4) are exempted from the
 * type-category check and asserted explicitly at the bottom of this file.
 * Every future dialect-specific column must be added to the exemption list
 * with a comment explaining the architectural reason.
 */

const tablePairs = [
  ['projects', sq.projects, pg.projects],
  ['runs', sq.runs, pg.runs],
  ['run_events', sq.runEvents, pg.runEvents],
  ['context_packs', sq.contextPacks, pg.contextPacks],
  ['pending_jobs', sq.pendingJobs, pg.pendingJobs],
] as const;

/** Columns whose dialect-specific type difference is architecturally intentional. */
const DIALECT_TYPE_EXEMPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['context_packs', new Set(['summaryEmbedding'])],
]);

function columnsOf(table: unknown): Record<string, Column> {
  return getTableColumns(table as Parameters<typeof getTableColumns>[0]) as Record<string, Column>;
}

describe('5-table core is present in both dialects', () => {
  it('SQLite exports all five tables', () => {
    expect(sq.projects).toBeDefined();
    expect(sq.runs).toBeDefined();
    expect(sq.runEvents).toBeDefined();
    expect(sq.contextPacks).toBeDefined();
    expect(sq.pendingJobs).toBeDefined();
  });

  it('Postgres exports all five tables', () => {
    expect(pg.projects).toBeDefined();
    expect(pg.runs).toBeDefined();
    expect(pg.runEvents).toBeDefined();
    expect(pg.contextPacks).toBeDefined();
    expect(pg.pendingJobs).toBeDefined();
  });
});

describe('column-name parity per table', () => {
  for (const [name, sqliteTable, pgTable] of tablePairs) {
    it(`${name}: column names match exactly`, () => {
      const sqliteCols = Object.keys(columnsOf(sqliteTable)).sort();
      const pgCols = Object.keys(columnsOf(pgTable)).sort();
      expect(sqliteCols).toEqual(pgCols);
    });
  }
});

describe('notNull parity per column', () => {
  for (const [name, sqliteTable, pgTable] of tablePairs) {
    it(`${name}: every column has matching notNull flag`, () => {
      const sqliteCols = columnsOf(sqliteTable);
      const pgCols = columnsOf(pgTable);
      for (const field of Object.keys(sqliteCols)) {
        const sqliteCol = sqliteCols[field];
        const pgCol = pgCols[field];
        expect(sqliteCol).toBeDefined();
        expect(pgCol).toBeDefined();
        expect({ table: name, field, notNull: sqliteCol?.notNull }).toEqual({
          table: name,
          field,
          notNull: pgCol?.notNull,
        });
      }
    });
  }
});

describe('dataType parity per column (with architected exemptions)', () => {
  for (const [name, sqliteTable, pgTable] of tablePairs) {
    it(`${name}: dataType category matches (exempting intentional drift)`, () => {
      const sqliteCols = columnsOf(sqliteTable);
      const pgCols = columnsOf(pgTable);
      const exempt = DIALECT_TYPE_EXEMPTIONS.get(name) ?? new Set<string>();
      for (const field of Object.keys(sqliteCols)) {
        if (exempt.has(field)) {
          continue;
        }
        const s = sqliteCols[field]?.dataType;
        const p = pgCols[field]?.dataType;
        expect({ table: name, field, dataType: s }).toEqual({
          table: name,
          field,
          dataType: p,
        });
      }
    });
  }
});

describe('architected dialect drift', () => {
  it('context_packs.summary_embedding is TEXT in SQLite and vector(384) in Postgres', () => {
    const sqliteCols = columnsOf(sq.contextPacks);
    const pgCols = columnsOf(pg.contextPacks);
    expect(sqliteCols.summaryEmbedding?.dataType).toBe('string');
    // drizzle's pg vector column reports dataType 'array' — assert it's not 'string'
    // so silent regressions to plain text are caught.
    expect(pgCols.summaryEmbedding?.dataType).not.toBe('string');
  });
});
