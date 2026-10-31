import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setupInstallSchema,
  setupStatusResponseSchema,
  type SetupStatusResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../security/decorators.js';
import { SetupService } from './setup.service.js';

@ApiTags('setup')
@Controller({ path: 'setup', version: '1' })
@Public()
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Setup wizard environment checks (only "installed: true" once installed)',
  })
  @ApiOkResponse({ standardSchema: setupStatusResponseSchema })
  status(@Req() req: Request): Promise<SetupStatusResponse> {
    return this.setup.status(req.secure);
  }

  @Post('install')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Complete installation (requires the one-time setup token)' })
  @ZodBody(setupInstallSchema)
  async install(
    @Body(new ZodValidationPipe(setupInstallSchema)) body: z.output<typeof setupInstallSchema>,
    @Req() req: Request,
  ): Promise<{ installed: true }> {
    await this.setup.install(body, requestMeta(req));
    return { installed: true };
  }
}
