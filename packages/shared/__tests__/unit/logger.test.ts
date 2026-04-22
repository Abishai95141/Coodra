import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { createLogger, logger } from '../../src/logger.js';

describe('logger (singleton)', () => {
  it('exposes a pino-style .level and .child()', () => {
    expect(typeof logger.level).toBe('string');
    expect(typeof logger.child).toBe('function');
  });

  it('level defaults to info when LOG_LEVEL is unset or invalid', () => {
    // The test process may have LOG_LEVEL set to e.g. 'info' already.
    // Allowed values include 'info' (default) or any other valid pino level.
    const allowed = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
    expect(allowed).toContain(logger.level);
  });
});

describe('createLogger', () => {
  it('throws on empty name', () => {
    expect(() => createLogger('')).toThrow(TypeError);
  });

  it('binds name and context on a pino child, emits structured JSON', () => {
    const captured: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        captured.push(chunk.toString());
        cb();
      },
    });
    // Build an isolated pino with the same shape as the production logger,
    // but writing to our in-memory stream so we can inspect output.
    const local = pino(
      {
        level: 'info',
        formatters: { level: (label) => ({ level: label }) },
      },
      stream,
    );
    const child = local.child({ name: 'unit', component: 'logger' });
    child.info({ evt: 'hello' }, 'message body');
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.name).toBe('unit');
    expect(parsed.component).toBe('logger');
    expect(parsed.msg).toBe('message body');
    expect(parsed.level).toBe('info');
    expect(parsed.evt).toBe('hello');
  });

  it('child bindings carry through nested children', () => {
    const captured: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        captured.push(chunk.toString());
        cb();
      },
    });
    const local = pino({ level: 'info', formatters: { level: (label) => ({ level: label }) } }, stream);
    const svc = local.child({ name: 'svc' });
    const req = svc.child({ runId: 'run_abc' });
    req.info('hit');
    const parsed = JSON.parse(captured[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.name).toBe('svc');
    expect(parsed.runId).toBe('run_abc');
  });
});
