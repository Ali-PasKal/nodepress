import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isDatabaseUnavailableError } from '../../infrastructure/database/database-errors.js';
import { ApiException } from './api-exception.js';
import { mapError } from './error-mapping.js';

/** Converts every unhandled exception into the uniform API error envelope. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const normalised = isDatabaseUnavailableError(exception)
      ? new ApiException(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.')
      : exception;
    const mapped = mapError(normalised, requestId);

    if (mapped.isServerError) {
      this.logger.error(
        { err: exception, requestId, method: request.method, path: request.path },
        'Request failed with a server error',
      );
    }

    if (response.headersSent) {
      // Streaming already started; the connection is the only thing left to terminate.
      response.end();
      return;
    }
    response.status(mapped.status).json(mapped.body);
  }
}
