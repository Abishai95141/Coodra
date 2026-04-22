import { describe, expect, it } from 'vitest';

import {
  AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  isAppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../src/errors/index.js';

describe('AppError', () => {
  it('is instanceof Error and AppError', () => {
    const err = new AppError('base', { code: 'X', statusCode: 500 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('carries code and statusCode', () => {
    const err = new AppError('base', { code: 'X_CODE', statusCode: 418 });
    expect(err.code).toBe('X_CODE');
    expect(err.statusCode).toBe(418);
  });

  it('name equals the subclass constructor name', () => {
    const err = new AppError('base', { code: 'X', statusCode: 500 });
    expect(err.name).toBe('AppError');
  });

  it('preserves cause when provided', () => {
    const cause = new Error('underlying');
    const err = new AppError('wrapper', { code: 'X', statusCode: 500, cause });
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it('omits cause when not provided (exactOptionalPropertyTypes)', () => {
    const err = new AppError('nocause', { code: 'X', statusCode: 500 });
    expect((err as unknown as { cause?: unknown }).cause).toBeUndefined();
  });

  it('serialises to JSON with code + statusCode + message', () => {
    const err = new AppError('msg', { code: 'X', statusCode: 400, details: { field: 'foo' } });
    expect(err.toJSON()).toEqual({
      name: 'AppError',
      code: 'X',
      statusCode: 400,
      message: 'msg',
      details: { field: 'foo' },
    });
  });

  it('omits details from JSON when not set', () => {
    const err = new AppError('msg', { code: 'X', statusCode: 400 });
    expect(err.toJSON()).toEqual({
      name: 'AppError',
      code: 'X',
      statusCode: 400,
      message: 'msg',
    });
  });
});

describe('subclass table', () => {
  const cases: ReadonlyArray<readonly [AppError, string, string, number]> = [
    [new ValidationError('v'), 'ValidationError', 'VALIDATION_ERROR', 400],
    [new UnauthorizedError('u'), 'UnauthorizedError', 'UNAUTHORIZED', 401],
    [new ForbiddenError('f'), 'ForbiddenError', 'FORBIDDEN', 403],
    [new NotFoundError('n'), 'NotFoundError', 'NOT_FOUND', 404],
    [new ConflictError('c'), 'ConflictError', 'CONFLICT', 409],
    [new InternalError('i'), 'InternalError', 'INTERNAL', 500],
  ];

  for (const [err, name, code, statusCode] of cases) {
    it(`${name} has name=${name}, code=${code}, statusCode=${statusCode}`, () => {
      expect(err).toBeInstanceOf(AppError);
      expect(err.name).toBe(name);
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(statusCode);
    });
  }

  it('UnauthorizedError defaults message to "Unauthenticated"', () => {
    const err = new UnauthorizedError();
    expect(err.message).toBe('Unauthenticated');
  });

  it('ForbiddenError defaults message to "Forbidden"', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('Forbidden');
  });

  it('ValidationError passes through cause + details', () => {
    const cause = new Error('zod');
    const err = new ValidationError('bad', cause, { issueCount: 2 });
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
    expect(err.details).toEqual({ issueCount: 2 });
  });
});

describe('isAppError', () => {
  it('returns true for AppError instances', () => {
    expect(isAppError(new AppError('x', { code: 'X', statusCode: 500 }))).toBe(true);
    expect(isAppError(new NotFoundError('nope'))).toBe(true);
  });

  it('returns false for plain Errors', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError({ code: 'X' })).toBe(false);
  });
});
