import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/**
 * Tracks graceful shutdown. Nest calls `beforeApplicationShutdown` before it closes the HTTP server;
 * from that moment readiness reports 503, and we optionally keep serving for SHUTDOWN_DELAY_MS so a
 * load balancer notices and stops routing new traffic before connections are closed.
 */
@Injectable()
export class ShutdownState implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ShutdownState.name);
  private shuttingDown = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    const delay = this.config.http.shutdownDelayMs;
    this.logger.log({ signal, delayMs: delay }, 'Shutdown requested; readiness now failing');
    if (delay > 0) {
      await sleep(delay);
    }
  }
}
