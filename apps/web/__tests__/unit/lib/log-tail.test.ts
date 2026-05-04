import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isLogService, readLastLines, tailFromOffset } from '@/lib/log-tail';

/**
 * Unit tests for `apps/web/lib/log-tail.ts` (M04 Phase 2 S11).
 *
 * Exercise the backwards-chunked reader + the tail-from-offset
 * resume path. The SSE route + watcher are deferred to the live
 * smoke test (they need an actual EventSource client).
 */

let tmpRoot: string;
let logPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cxos-s11-tail-'));
  logPath = join(tmpRoot, 'test.log');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('isLogService', () => {
  it('accepts the three known services', () => {
    expect(isLogService('hooks-bridge')).toBe(true);
    expect(isLogService('mcp-server')).toBe(true);
    expect(isLogService('sync-daemon')).toBe(true);
  });
  it('rejects unknown services', () => {
    expect(isLogService('etc-passwd')).toBe(false);
    expect(isLogService('')).toBe(false);
    expect(isLogService('hooks-bridge.log')).toBe(false);
  });
});

describe('readLastLines', () => {
  it('returns missing when file does not exist', () => {
    const result = readLastLines(logPath, 10);
    expect(result.missing).toBe(true);
    expect(result.lines).toEqual([]);
    expect(result.endOffset).toBe(0);
  });

  it('returns the last n lines from a small file', () => {
    writeFileSync(logPath, 'one\ntwo\nthree\nfour\nfive\n');
    const result = readLastLines(logPath, 3);
    expect(result.lines).toEqual(['three', 'four', 'five']);
    // endOffset is the file size — every line was '\n'-terminated.
    expect(result.endOffset).toBe(24);
  });

  it('returns all lines when n exceeds line count', () => {
    writeFileSync(logPath, 'a\nb\n');
    const result = readLastLines(logPath, 10);
    expect(result.lines).toEqual(['a', 'b']);
  });

  it('handles a file without a trailing newline', () => {
    writeFileSync(logPath, 'first\nsecond\nthird');
    const result = readLastLines(logPath, 2);
    expect(result.lines).toEqual(['second', 'third']);
  });

  it('handles a file larger than the read chunk (tens of KB)', () => {
    // 1000 lines × ~30 bytes = ~30KB → spans multiple 16KB chunks.
    const big = Array.from({ length: 1000 }, (_, i) => `line-${String(i).padStart(4, '0')}-x`).join('\n');
    writeFileSync(logPath, `${big}\n`);
    const result = readLastLines(logPath, 5);
    expect(result.lines).toEqual(['line-0995-x', 'line-0996-x', 'line-0997-x', 'line-0998-x', 'line-0999-x']);
  });

  it('returns empty for n=0', () => {
    writeFileSync(logPath, 'a\nb\n');
    const result = readLastLines(logPath, 0);
    expect(result.lines).toEqual([]);
    expect(result.endOffset).toBe(4);
  });
});

describe('tailFromOffset', () => {
  it('returns no lines when nothing changed', () => {
    writeFileSync(logPath, 'one\ntwo\n');
    const result = tailFromOffset(logPath, 8);
    expect(result.lines).toEqual([]);
    expect(result.newOffset).toBe(8);
  });

  it('returns appended complete lines and advances the offset', () => {
    writeFileSync(logPath, 'one\ntwo\n');
    appendFileSync(logPath, 'three\nfour\n');
    const result = tailFromOffset(logPath, 8);
    expect(result.lines).toEqual(['three', 'four']);
    expect(result.newOffset).toBe(8 + 'three\nfour\n'.length);
  });

  it('holds back a partial trailing line until it is complete', () => {
    writeFileSync(logPath, 'a\nb\n');
    appendFileSync(logPath, 'partial-no-newline');
    // We have a partial line at the tail — should NOT emit it yet.
    const r1 = tailFromOffset(logPath, 4);
    expect(r1.lines).toEqual([]);
    expect(r1.newOffset).toBe(4); // unchanged because no complete line yet

    // Now finish the line.
    appendFileSync(logPath, '-now-complete\n');
    const r2 = tailFromOffset(logPath, 4);
    expect(r2.lines).toEqual(['partial-no-newline-now-complete']);
  });

  it('detects truncation/rotation by resetting offset to current size', () => {
    writeFileSync(logPath, 'a\nb\nc\n');
    // Simulate rotation: file shrinks (e.g., logrotate truncated it).
    writeFileSync(logPath, '');
    const result = tailFromOffset(logPath, 6);
    expect(result.lines).toEqual([]);
    expect(result.newOffset).toBe(0); // reset to current EOF
  });

  it('returns missing-style empty when file is gone', () => {
    const result = tailFromOffset(join(tmpRoot, 'never-existed.log'), 100);
    expect(result.lines).toEqual([]);
    expect(result.newOffset).toBe(100);
  });
});
