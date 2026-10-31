import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  livenessResponseSchema,
  readinessResponseSchema,
  type LivenessResponse,
  type ReadinessResponse,
} from '@nexora/shared';
import type { Response } from 'express';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Reports that the process is running and able to serve HTTP. Performs no dependency checks.',
  })
  @ApiOkResponse({ standardSchema: livenessResponseSchema })
  live(): LivenessResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks the database connection, that all shipped migrations are applied, the optional cache, and ' +
      'whether the process is shutting down. Returns 503 when the instance should not receive traffic.',
  })
  @ApiOkResponse({
    description: 'Ready (status "ok" or "degraded")',
    standardSchema: readinessResponseSchema,
  })
  @ApiServiceUnavailableResponse({
    description: 'Not ready (status "error")',
    standardSchema: readinessResponseSchema,
  })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    response.status(result.status === 'error' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK);
    return result;
  }
}
