/** Connection string for the dedicated integration-test database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://nexora:nexora_dev_password@127.0.0.1:5432/nexora_test';

/** Optional: set to a reachable Redis-compatible server to run cache integration tests. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

/** An address where nothing listens, used to simulate unavailable dependencies. */
export const UNREACHABLE_DATABASE_URL = 'postgresql://nexora:unused@127.0.0.1:1/unreachable';
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1';

/**
 * Refuses to operate on anything that is not clearly a disposable test database, so a misconfigured
 * TEST_DATABASE_URL can never wipe a development or production database.
 */
export function assertDisposableTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to reset database "${name}": integration tests only run against databases whose name ends in "_test".`,
    );
  }
}
