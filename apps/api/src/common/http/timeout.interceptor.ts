import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { throwError, timeout, type Observable } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { ApiException } from '../errors/api-exception.js';

/**
 * Bounds handler execution time. Note: this stops waiting and responds 503, but cannot cancel work
 * already in progress; database statements are additionally bounded by `statement_timeout`.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout({
        first: this.config.http.requestTimeoutMs,
        with: () =>
          throwError(
            () => new ApiException(503, 'REQUEST_TIMEOUT', 'The request took too long to process.'),
          ),
      }),
    );
  }
}
