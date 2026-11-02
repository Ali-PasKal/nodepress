import { Module } from '@nestjs/common';
import { AppearanceModule } from '../appearance/appearance.module.js';
import { ExtensionsModule } from '../extensions/extensions.module.js';
import { MediaUrls } from '../media/media-urls.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';

@Module({
  imports: [AppearanceModule, ExtensionsModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, MediaUrls],
})
export class DeliveryModule {}
