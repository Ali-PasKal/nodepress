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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  mediaDetailSchema,
  mediaLimitsSchema,
  mediaListQuerySchema,
  mediaListResponseSchema,
  updateMediaSchema,
  uuidSchema,
  type MediaDetail,
  type MediaLimits,
  type MediaListResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { RequestTimeout } from '../../common/http/timeout.interceptor.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireAnyCapability, RequireCapabilities } from '../security/decorators.js';
import { MediaService, type UploadedFile as StoredUpload } from './media.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const uploadFieldsSchema = z.object({
  title: z.string().max(255).optional(),
  altText: z.string().max(500).optional(),
});

@ApiTags('media')
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  @RequireAnyCapability('media.upload', 'media.manage', 'content.read')
  @ApiOperation({ summary: 'List the media library' })
  @ApiOkResponse({ standardSchema: mediaListResponseSchema })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(mediaListQuerySchema))
    query: z.output<typeof mediaListQuerySchema>,
  ): Promise<MediaListResponse> {
    return this.media.list(auth, query);
  }

  @Get('limits')
  @RequireAnyCapability('media.upload', 'media.manage')
  @ApiOperation({ summary: 'Upload size limit and accepted file types' })
  @ApiOkResponse({ standardSchema: mediaLimitsSchema })
  limits(): MediaLimits {
    return this.media.limits();
  }

  @Post()
  @RequireCapabilities('media.upload')
  @RequestTimeout((config) => config.media.uploadTimeoutMs)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a file (multipart/form-data, field "file")' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        altText: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ standardSchema: mediaDetailSchema })
  upload(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: StoredUpload | undefined,
    @Body(new ZodValidationPipe(uploadFieldsSchema)) fields: z.output<typeof uploadFieldsSchema>,
    @Req() req: Request,
  ): Promise<MediaDetail> {
    return this.media.upload(auth, file, fields, requestMeta(req));
  }

  @Get(':id')
  @RequireAnyCapability('media.upload', 'media.manage', 'content.read')
  @ApiOperation({ summary: 'A file with its usage count' })
  @ApiOkResponse({ standardSchema: mediaDetailSchema })
  get(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<MediaDetail> {
    return this.media.get(auth, id);
  }

  @Patch(':id')
  @RequireAnyCapability('media.upload', 'media.manage')
  @ApiOperation({
    summary: 'Edit title, alt text or caption (own files, or anyone’s with media.manage)',
  })
  @ZodBody(updateMediaSchema)
  @ApiOkResponse({ standardSchema: mediaDetailSchema })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateMediaSchema)) body: z.output<typeof updateMediaSchema>,
  ): Promise<MediaDetail> {
    return this.media.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAnyCapability('media.upload', 'media.manage')
  @ApiOperation({ summary: 'Delete a file (own files, or anyone’s with media.manage)' })
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.media.delete(auth, id, requestMeta(req));
  }
}
