/**
 * Detects errors meaning "the database cannot be used right now" (as opposed to a bad query), so they
 * can be reported as 503 Service Unavailable instead of 500.
 *
 * Prisma 7 with a driver adapter reports connection problems as `PrismaClientKnownRequestError` with
 * the adapter's classification at `meta.driverAdapterError.cause.kind`, and the PostgreSQL SQLSTATE
 * (when there is one) at `cause.originalCode`.
 */

/** Driver adapter error kinds that indicate unavailability or deployment misconfiguration. */
const UNAVAILABLE_ADAPTER_KINDS = new Set([
  'DatabaseNotReachable',
  'DatabaseDoesNotExist',
  'DatabaseAccessDenied',
  'AuthenticationFailed',
  'ConnectionClosed',
  'TlsConnectionError',
  'TooManyConnections',
  'SocketTimeout',
]);

/** Prisma connection-level error codes (P1xxx) and pool timeout (P2024). */
const UNAVAILABLE_PRISMA_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
]);

/**
 * PostgreSQL SQLSTATEs: 08xxx connection exceptions, 53300 too_many_connections, 55000 (raised for
 * "database is not currently accepting connections"), 57P01-57P03 server shutdown / cannot connect now.
 */
const UNAVAILABLE_SQLSTATES = new Set(['53300', '55000', '57P01', '57P02', '57P03']);
const CONNECTION_EXCEPTION_SQLSTATE_CLASS = '08';

/** Node.js network error codes. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

const MAX_DEPTH = 5;

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  cause?: unknown;
  kind?: unknown;
  originalCode?: unknown;
  meta?: { driverAdapterError?: unknown };
}

function isSqlStateUnavailable(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (UNAVAILABLE_SQLSTATES.has(code) ||
      (code.length === 5 && code.startsWith(CONNECTION_EXCEPTION_SQLSTATE_CLASS)))
  );
}

export function isDatabaseUnavailableError(error: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as ErrorLike;

  if (candidate.name === 'PrismaClientInitializationError') {
    return true;
  }
  // Driver adapter classification object (`{ kind, originalCode, ... }`).
  if (typeof candidate.kind === 'string') {
    if (UNAVAILABLE_ADAPTER_KINDS.has(candidate.kind)) {
      return true;
    }
    if (candidate.kind === 'postgres' && isSqlStateUnavailable(candidate.originalCode)) {
      return true;
    }
  }
  if (typeof candidate.code === 'string') {
    if (UNAVAILABLE_PRISMA_CODES.has(candidate.code) || NETWORK_ERROR_CODES.has(candidate.code)) {
      return true;
    }
    if (isSqlStateUnavailable(candidate.code)) {
      return true;
    }
  }
  if (
    error instanceof AggregateError &&
    error.errors.some((inner) => isDatabaseUnavailableError(inner, depth + 1))
  ) {
    return true;
  }
  return (
    isDatabaseUnavailableError(candidate.meta?.driverAdapterError, depth + 1) ||
    isDatabaseUnavailableError(candidate.cause, depth + 1)
  );
}
