import { Module } from '@nestjs/common';
import { ExtensionsModule } from '../extensions/extensions.module.js';
import { MediaUrls } from '../media/media-urls.js';
import { RedirectsModule } from '../redirects/redirects.module.js';
import { ContentModelController } from './content-model.controller.js';
import { ContentModelService } from './content-model.service.js';
import { EntriesController } from './entries.controller.js';
import { EntriesService } from './entries.service.js';
import { TermsController } from './terms.controller.js';
import { TermsService } from './terms.service.js';

@Module({
  imports: [RedirectsModule, ExtensionsModule],
  controllers: [ContentModelController, TermsController, EntriesController],
  providers: [ContentModelService, TermsService, EntriesService, MediaUrls],
  exports: [ContentModelService, EntriesService],
})
export class ContentModule {}
