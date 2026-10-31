import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailableError } from './database-errors.js';

/** Shapes observed from Prisma 7.10 + @prisma/adapter-pg against a real PostgreSQL server. */
function prismaError(code: string, cause: Record<string, unknown>): Error {
  const error = new Error('Invalid invocation') as Error & { code: string; meta: unknown };
  error.name = 'PrismaClientKnownRequestError';
  error.code = code;
  error.meta = {
    driverAdapterError: Object.assign(new Error('adapter'), { name: 'DriverAdapterError', cause }),
  };
  return error;
}

describe('isDatabaseUnavailableError', () => {
  it.each([
    [
      'server not reachable (model query)',
      prismaError('P1001', { kind: 'DatabaseNotReachable', host: 'db', port: 5432 }),
    ],
    [
      'server not reachable (raw query)',
      prismaError('P2010', { kind: 'DatabaseNotReachable', host: 'db', port: 5432 }),
    ],
    [
      'database missing',
      prismaError('P1003', { kind: 'DatabaseDoesNotExist', originalCode: '3D000' }),
    ],
    ['authentication failed', prismaError('P2010', { kind: 'AuthenticationFailed' })],
    [
      'not accepting connections',
      prismaError('P2010', { kind: 'postgres', originalCode: '55000' }),
    ],
    ['admin shutdown', prismaError('P2010', { kind: 'postgres', originalCode: '57P01' })],
    [
      'connection exception class 08',
      prismaError('P2010', { kind: 'postgres', originalCode: '08006' }),
    ],
  ])('detects %s', (_label, error) => {
    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it('detects raw network errors and nested causes', () => {
    const network = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(isDatabaseUnavailableError(network)).toBe(true);
    expect(isDatabaseUnavailableError(new Error('wrapped', { cause: network }))).toBe(true);
    expect(isDatabaseUnavailableError(new AggregateError([new Error('x'), network]))).toBe(true);
  });

  it.each([
    ['unique violation', prismaError('P2002', { kind: 'UniqueConstraintViolation' })],
    ['syntax error', prismaError('P2010', { kind: 'postgres', originalCode: '42601' })],
    ['plain error', new Error('boom')],
    ['non-error value', 'ECONNREFUSED'],
    ['null', null],
  ])('does not classify %s as unavailability', (_label, error) => {
    expect(isDatabaseUnavailableError(error)).toBe(false);
  });

  it('does not recurse forever on cyclic causes', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(isDatabaseUnavailableError(a)).toBe(false);
  });
});
