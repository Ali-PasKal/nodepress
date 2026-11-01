import { Global, Module } from '@nestjs/common';
import { JobQueue } from './job-queue.service.js';
import { JobRegistry } from './job-registry.service.js';
import { JobWorker } from './job-worker.service.js';
import { JobsController } from './jobs.controller.js';

/** Durable background jobs. Global so feature modules can register handlers and enqueue jobs. */
@Global()
@Module({
  controllers: [JobsController],
  providers: [JobRegistry, JobQueue, JobWorker],
  exports: [JobRegistry, JobQueue, JobWorker],
})
export class JobsModule {}
