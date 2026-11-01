import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, timer, map } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { ApiException } from '../errors/api-exception.js';
import { RequestTimeout, TimeoutInterceptor } from './timeout.interceptor.js';

const config = { http: { requestTimeoutMs: 30 } } as unknown as AppConfig;
const plainHandler = () => undefined;
const context = { getHandler: () => plainHandler } as unknown as ExecutionContext;
const handler = (source: CallHandler['handle']): CallHandler => ({ handle: source });

describe('TimeoutInterceptor', () => {
  it('passes through responses produced within the limit', async () => {
    const interceptor = new TimeoutInterceptor(config, new Reflector());
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
    const interceptor = new TimeoutInterceptor(config, new Reflector());
    const slow = handler(() => timer(200).pipe(map(() => 'late')));
    const error = await firstValueFrom(interceptor.intercept(context, slow)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(503);
    expect((error as ApiException).code).toBe('REQUEST_TIMEOUT');
  });

  it('honours a per-route override', async () => {
    class Routes {
      @RequestTimeout(() => 500)
      upload(): void {
        // marker
      }
    }
    const routeContext = {
      getHandler: () =>
        Object.getOwnPropertyDescriptor(Routes.prototype, 'upload')!.value as () => void,
    } as unknown as ExecutionContext;
    const interceptor = new TimeoutInterceptor(config, new Reflector());
    const slowish = handler(() => timer(100).pipe(map(() => 'done')));
    await expect(firstValueFrom(interceptor.intercept(routeContext, slowish))).resolves.toBe(
      'done',
    );
  });
});
