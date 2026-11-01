import { Module } from '@nestjs/common';
import { MediaUrls } from '../media/media-urls.js';
import { AppearanceController } from './appearance.controller.js';
import { MenusController } from './menus.controller.js';
import { MenusService } from './menus.service.js';
import { SiteSettingsService } from './site-settings.service.js';
import { ThemeRegistry } from './theme-registry.js';

@Module({
  controllers: [AppearanceController, MenusController],
  providers: [ThemeRegistry, SiteSettingsService, MenusService, MediaUrls],
  exports: [ThemeRegistry, SiteSettingsService, MenusService],
})
export class AppearanceModule {}
