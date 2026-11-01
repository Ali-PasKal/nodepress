import {
  Inject,
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwError, timeout, type Observable } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { ApiException } from '../errors/api-exception.js';

const TIMEOUT_OVERRIDE = Symbol('nexora:request-timeout');
type TimeoutOverride = (config: AppConfig) => number;

/** Per-route timeout (e.g. uploads, whose body is parsed inside the timed section). */
export const RequestTimeout = (resolve: TimeoutOverride) => SetMetadata(TIMEOUT_OVERRIDE, resolve);

/**
 * Bounds handler execution time. Note: this stops waiting and responds 503, but cannot cancel work
 * already in progress; database statements are additionally bounded by `statement_timeout`.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const override = this.reflector.get<TimeoutOverride | undefined>(
      TIMEOUT_OVERRIDE,
      context.getHandler(),
    );
    return next.handle().pipe(
      timeout({
        first: override ? override(this.config) : this.config.http.requestTimeoutMs,
        with: () =>
          throwError(
            () => new ApiException(503, 'REQUEST_TIMEOUT', 'The request took too long to process.'),
          ),
      }),
    );
  }
}
