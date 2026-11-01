import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEntrySchema,
  entryBulkResponseSchema,
  entryBulkSchema,
  entryDetailSchema,
  entryListQuerySchema,
  entryListResponseSchema,
  restoreRevisionSchema,
  revisionDetailSchema,
  revisionSummarySchema,
  updateEntrySchema,
  uuidSchema,
  type EntryBulkResponse,
  type EntryDetail,
  type EntryListResponse,
  type RevisionDetail,
  type RevisionSummary,
} from '@nexora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireAnyCapability, RequireCapabilities } from '../security/decorators.js';
import { EntriesService } from './entries.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('entries')
@Controller({ path: 'entries', version: '1' })
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Get()
  @RequireAnyCapability('content.read', 'content.create', 'content.edit_others')
  @ApiOperation({ summary: 'List entries of a content type (own only, unless allowed to see all)' })
  @ApiOkResponse({ standardSchema: entryListResponseSchema })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(entryListQuerySchema))
    query: z.output<typeof entryListQuerySchema>,
  ): Promise<EntryListResponse> {
    return this.entries.list(auth, query);
  }

  @Post()
  @RequireCapabilities('content.create')
  @ApiOperation({ summary: 'Create an entry' })
  @ZodBody(createEntrySchema)
  @ApiOkResponse({ standardSchema: entryDetailSchema })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createEntrySchema)) body: z.output<typeof createEntrySchema>,
    @Req() req: Request,
  ): Promise<EntryDetail> {
    return this.entries.create(auth, body, requestMeta(req));
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @RequireAnyCapability('content.create', 'content.edit_others', 'content.delete')
  @ApiOperation({ summary: 'Apply an action to several entries (each checked individually)' })
  @ZodBody(entryBulkSchema)
  @ApiOkResponse({ standardSchema: entryBulkResponseSchema })
  bulk(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(entryBulkSchema)) body: z.output<typeof entryBulkSchema>,
    @Req() req: Request,
  ): Promise<EntryBulkResponse> {
    return this.entries.bulk(auth, body, requestMeta(req));
  }

  @Get(':id')
  @RequireAnyCapability('content.read', 'content.create', 'content.edit_others')
  @ApiOperation({ summary: 'Get an entry with its content and your permissions' })
  @ApiOkResponse({ standardSchema: entryDetailSchema })
  get(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<EntryDetail> {
    return this.entries.get(auth, id);
  }

  @Patch(':id')
  @RequireAnyCapability('content.create', 'content.edit_others')
  @ApiOperation({
    summary: 'Update content and/or status; requires the current version (409 on conflict)',
  })
  @ZodBody(updateEntrySchema)
  @ApiOkResponse({ standardSchema: entryDetailSchema })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateEntrySchema)) body: z.output<typeof updateEntrySchema>,
    @Req() req: Request,
  ): Promise<EntryDetail> {
    return this.entries.update(auth, id, body, requestMeta(req));
  }

  @Post(':id/trash')
  @HttpCode(HttpStatus.OK)
  @RequireCapabilities('content.delete')
  @ApiOperation({ summary: 'Move an entry to the trash' })
  @ApiOkResponse({ standardSchema: entryDetailSchema })
  trash(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<EntryDetail> {
    return this.entries.trash(auth, id, requestMeta(req));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequireCapabilities('content.delete')
  @ApiOperation({ summary: 'Restore an entry from the trash' })
  @ApiOkResponse({ standardSchema: entryDetailSchema })
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<EntryDetail> {
    return this.entries.restore(auth, id, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapabilities('content.delete')
  @ApiOperation({ summary: 'Permanently delete a trashed entry' })
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.entries.deletePermanently(auth, id, requestMeta(req));
  }

  @Get(':id/revisions')
  @RequireAnyCapability('content.read', 'content.create', 'content.edit_others')
  @ApiOperation({ summary: 'Revisions of an entry, newest first' })
  @ApiOkResponse({ standardSchema: z.array(revisionSummarySchema) })
  revisions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
  ): Promise<RevisionSummary[]> {
    return this.entries.revisions(auth, id);
  }

  @Get(':id/revisions/:revisionId')
  @RequireAnyCapability('content.read', 'content.create', 'content.edit_others')
  @ApiOperation({ summary: 'A revision with its full content' })
  @ApiOkResponse({ standardSchema: revisionDetailSchema })
  revision(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Param('revisionId', idPipe) revisionId: string,
  ): Promise<RevisionDetail> {
    return this.entries.revision(auth, id, revisionId);
  }

  @Post(':id/revisions/:revisionId/restore')
  @HttpCode(HttpStatus.OK)
  @RequireAnyCapability('content.create', 'content.edit_others')
  @ApiOperation({ summary: 'Restore a revision (saved as a new revision)' })
  @ZodBody(restoreRevisionSchema)
  @ApiOkResponse({ standardSchema: entryDetailSchema })
  restoreRevision(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Param('revisionId', idPipe) revisionId: string,
    @Body(new ZodValidationPipe(restoreRevisionSchema))
    body: z.output<typeof restoreRevisionSchema>,
    @Req() req: Request,
  ): Promise<EntryDetail> {
    return this.entries.restoreRevision(auth, id, revisionId, body.version, requestMeta(req));
  }
}
