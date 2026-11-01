import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  jobListQuerySchema,
  jobListResponseSchema,
  jobOverviewSchema,
  jobSummarySchema,
  uuidSchema,
  type JobListResponse,
  type JobOverview,
  type JobSummary,
} from '@nexora/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireCapabilities } from '../security/decorators.js';
import { JobQueue } from './job-queue.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('jobs')
@Controller({ path: 'jobs', version: '1' })
export class JobsController {
  constructor(private readonly queue: JobQueue) {}

  @Get()
  @RequireCapabilities('jobs.manage')
  @ApiOperation({ summary: 'List background jobs (payloads are not exposed)' })
  @ApiOkResponse({ standardSchema: jobListResponseSchema })
  list(
    @Query(new ZodValidationPipe(jobListQuerySchema)) query: z.output<typeof jobListQuerySchema>,
  ): Promise<JobListResponse> {
    return this.queue.list(query);
  }

  @Get('overview')
  @RequireCapabilities('jobs.manage')
  @ApiOperation({ summary: 'Queue counts, backlog age and worker heartbeats' })
  @ApiOkResponse({ standardSchema: jobOverviewSchema })
  overview(): Promise<JobOverview> {
    return this.queue.overview();
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequireCapabilities('jobs.manage')
  @ApiOperation({ summary: 'Retry a dead job with a fresh set of attempts' })
  @ApiOkResponse({ standardSchema: jobSummarySchema })
  retry(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<JobSummary> {
    return this.queue.retry(auth, id, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapabilities('jobs.manage')
  @ApiOperation({ summary: 'Discard a dead job' })
  async discard(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.queue.discard(auth, id, requestMeta(req));
  }
}
