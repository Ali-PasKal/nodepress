import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  auditListQuerySchema,
  auditListResponseSchema,
  type AuditListResponse,
} from '@nexora/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { RequireCapabilities } from '../security/decorators.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@Controller({ path: 'audit-events', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireCapabilities('audit.read')
  @ApiOperation({ summary: 'List audit events (newest first)' })
  @ApiOkResponse({ standardSchema: auditListResponseSchema })
  list(
    @Query(new ZodValidationPipe(auditListQuerySchema))
    query: z.output<typeof auditListQuerySchema>,
  ): Promise<AuditListResponse> {
    return this.audit.list(query);
  }
}
