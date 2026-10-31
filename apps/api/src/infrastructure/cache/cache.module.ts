import { Global, Module } from '@nestjs/common';
import { CacheClient } from './cache-client.service.js';

@Global()
@Module({
  providers: [CacheClient],
  exports: [CacheClient],
})
export class CacheModule {}
