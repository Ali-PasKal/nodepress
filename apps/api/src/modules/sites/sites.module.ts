import { Global, Module } from '@nestjs/common';
import { SiteService } from './site.service.js';

@Global()
@Module({ providers: [SiteService], exports: [SiteService] })
export class SitesModule {}
