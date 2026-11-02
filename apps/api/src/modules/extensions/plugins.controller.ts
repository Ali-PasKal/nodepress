import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  activatePluginSchema,
  pluginDetailSchema,
  pluginIdSchema,
  pluginLogsResponseSchema,
  pluginShortcodesResponseSchema,
  pluginsResponseSchema,
  type ActivatePluginInput,
  type PluginDetail,
  type PluginShortcodesResponse,
  type PluginsResponse,
} from '@nexora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../common/http/request-meta.js';
import { ZodBody } from '../../common/openapi/zod-body.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthContext } from '../security/auth-context.js';
import { CurrentAuth, RequireAnyCapability, RequireCapabilities } from '../security/decorators.js';
import { PluginsService } from './plugins.service.js';

const keyPipe = new ZodValidationPipe(pluginIdSchema);
const settingsBody = z.record(z.string(), z.unknown());

@ApiTags('plugins')
@Controller({ version: '1' })
export class PluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get('plugins')
  @RequireCapabilities('plugins.manage')
  @ApiOperation({ summary: 'Installed plugins and the first-party plugins that can be installed' })
  @ApiOkResponse({ standardSchema: pluginsResponseSchema })
  list(@CurrentAuth() auth: AuthContext): Promise<PluginsResponse> {
    return this.plugins.list(auth.siteId);
  }

  @Post('plugins')
  @RequireCapabilities('plugins.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Install or update a plugin from a package (.zip, multipart/form-data field "file")',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ standardSchema: pluginDetailSchema })
  upload(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() req: Request,
  ): Promise<PluginDetail> {
    return this.plugins.installUpload(auth, file, requestMeta(req));
  }

  @Post('plugins/bundled/:key')
  @RequireCapabilities('plugins.manage')
  @ApiOperation({ summary: 'Install or update a first-party plugin shipped with NEXORA' })
  @ApiOkResponse({ standardSchema: pluginDetailSchema })
  installBundled(
    @CurrentAuth() auth: AuthContext,
    @Param('key', keyPipe) key: string,
    @Req() req: Request,
  ): Promise<PluginDetail> {
    return this.plugins.installBundled(auth, key, requestMeta(req));
  }

  @Get('plugins/:key')
  @RequireCapabilities('plugins.manage')
  @ApiOperation({ summary: 'A plugin with its README, settings and shortcodes' })
  @ApiOkResponse({ standardSchema: pluginDetailSchema })
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('key', keyPipe) key: string,
  ): Promise<PluginDetail> {
    return this.plugins.detail(auth.siteId, key);
  }

  @Post('plugins/:key/activate')
  @RequireCapabilities('plugins.manage')
  @ApiOperation({
    summary: 'Activate a plugin, granting exactly the permissions and hosts its manifest asks for',
  })
  @ZodBody(activatePluginSchema)
  @ApiOkResponse({ standardSchema: pluginDetailSchema })
  activate(
    @CurrentAuth() auth: AuthContext,
    @Param('key', keyPipe) key: string,
    @Body(new ZodValidationPipe(activatePluginSchema)) body: ActivatePluginInput,
    @Req() req: Request,
  ): Promise<PluginDetail> {
    return this.plugins.activate(auth, key, body, requestMeta(req));
  }

  @Post('plugins/:key/deactivate')
  @RequireCapabilities('plugins.manage')
  @ApiOperation({ summary: 'Deactivate a plugin (its code stops running)' })
  @ApiOkResponse({ standardSchema: pluginDetailSchema })
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('key', keyPipe) key: string,
    @Req() req: Request,
  ): Promise<PluginDetail> {
    return this.plugins.deactivate(auth, key, requestMeta(req));
  }

  @Put('plugins/:key/settings')
  @RequireCapabilities('plugins.manage')
  @ApiOperation({
    summary: 'Change plugin settings (omitted keys keep their value; null clears a secret)',
  })
  @ApiOkResponse({ standardSchema: pluginDetailSchema })
  updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Param('key', keyPipe) key: string,
    @Body(new ZodValidationPipe(settingsBody)) body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<PluginDetail> {
    return this.plugins.updateSettings(auth, key, body, requestMeta(req));
  }

  @Get('plugins/:key/logs')
  @RequireCapabilities('plugins.manage')
  @ApiOperation({ summary: 'Recent log lines of a plugin' })
  @ApiOkResponse({ standardSchema: pluginLogsResponseSchema })
  async logs(
    @CurrentAuth() auth: AuthContext,
    @Param('key', keyPipe) key: string,
  ): Promise<z.infer<typeof pluginLogsResponseSchema>> {
    return { items: await this.plugins.logs(auth.siteId, key) };
  }

  @Delete('plugins/:key')
  @RequireCapabilities('plugins.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Uninstall an inactive plugin (removes its code, settings, storage and logs)',
  })
  async uninstall(
    @CurrentAuth() auth: AuthContext,
    @Param('key', keyPipe) key: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.plugins.uninstall(auth, key, requestMeta(req));
  }

  @Get('plugin-shortcodes')
  @RequireAnyCapability('content.create', 'content.edit_others', 'content.read')
  @ApiOperation({ summary: 'Shortcodes offered by active plugins (for editors)' })
  @ApiOkResponse({ standardSchema: pluginShortcodesResponseSchema })
  shortcodes(@CurrentAuth() auth: AuthContext): Promise<PluginShortcodesResponse> {
    return this.plugins.shortcodes(auth.siteId);
  }
}
