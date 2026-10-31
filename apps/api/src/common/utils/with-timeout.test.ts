import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resolves with the operation result when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('done'), 100)).resolves.toBe('done');
  });

  it('propagates the operation rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('failed')), 100)).rejects.toThrow('failed');
  });

  it('rejects with TimeoutError when the operation is too slow', async () => {
    const error = await withTimeout(sleep(200), 20).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeoutMs).toBe(20);
  });
});
