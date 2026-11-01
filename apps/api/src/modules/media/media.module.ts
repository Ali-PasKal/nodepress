import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { MediaController } from './media.controller.js';
import { MediaUrls } from './media-urls.js';
import { MediaService } from './media.service.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';
import { S3StorageDriver } from './storage/s3-storage.driver.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage-driver.js';
import { UploadsHandler } from './uploads.handler.js';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        // No destination: multer keeps the (size-limited) file in memory for sniffing and re-encoding.
        // One file per request, a few small text fields, nothing else.
        limits: {
          fileSize: config.media.maxUploadBytes,
          files: 1,
          fields: 5,
          fieldSize: 2_048,
          parts: 8,
          headerPairs: 50,
        },
      }),
    }),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaUrls,
    UploadsHandler,
    {
      provide: STORAGE_DRIVER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): StorageDriver =>
        config.media.storage === 's3' && config.media.s3
          ? new S3StorageDriver(config.media.s3)
          : new LocalStorageDriver(config.media.localDir),
    },
  ],
  exports: [MediaService, MediaUrls, UploadsHandler, STORAGE_DRIVER],
})
export class MediaModule {}
