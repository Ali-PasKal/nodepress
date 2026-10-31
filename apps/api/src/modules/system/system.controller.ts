import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  apiErrorResponseSchema,
  systemStatusResponseSchema,
  type SystemStatusResponse,
} from '@nexora/shared';
import { SystemService } from './system.service.js';

@ApiTags('system')
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Installation status',
    description:
      'Public, unauthenticated. Reports whether initial setup has been completed so clients can route to ' +
      'the setup wizard. Deliberately exposes no version or environment details.',
  })
  @ApiOkResponse({ standardSchema: systemStatusResponseSchema })
  @ApiServiceUnavailableResponse({
    description: 'Database unavailable',
    standardSchema: apiErrorResponseSchema,
  })
  getStatus(): Promise<SystemStatusResponse> {
    return this.system.getStatus();
  }
}
