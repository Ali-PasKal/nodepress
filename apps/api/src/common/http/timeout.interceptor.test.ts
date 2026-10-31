import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, timer, map } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { ApiException } from '../errors/api-exception.js';
import { TimeoutInterceptor } from './timeout.interceptor.js';

const config = { http: { requestTimeoutMs: 30 } } as unknown as AppConfig;
const context = {} as ExecutionContext;
const handler = (source: CallHandler['handle']): CallHandler => ({ handle: source });

describe('TimeoutInterceptor', () => {
  it('passes through responses produced within the limit', async () => {
    const interceptor = new TimeoutInterceptor(config);
    await expect(
      firstValueFrom(
        interceptor.intercept(
          context,
          handler(() => of('ok')),
        ),
      ),
    ).resolves.toBe('ok');
  });

  it('fails slow handlers with a 503 REQUEST_TIMEOUT ApiException', async () => {
    const interceptor = new TimeoutInterceptor(config);
    const slow = handler(() => timer(200).pipe(map(() => 'late')));
    const error = await firstValueFrom(interceptor.intercept(context, slow)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(503);
    expect((error as ApiException).code).toBe('REQUEST_TIMEOUT');
  });
});
