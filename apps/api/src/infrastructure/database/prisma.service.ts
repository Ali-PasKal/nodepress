import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * The application's single Prisma client. Connections are opened lazily so the process can start (and
 * report "not ready") while the database is unavailable. The pool is closed in `onApplicationShutdown`,
 * i.e. only after the HTTP server has stopped accepting requests and in-flight requests finished.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const logger = new Logger(PrismaService.name);
    const adapter = new PrismaPg(
      {
        connectionString: config.database.url,
        max: config.database.poolMax,
        connectionTimeoutMillis: config.database.connectTimeoutMs,
        // Server-side bounds so a slow query or abandoned transaction cannot hold a connection forever.
        statement_timeout: config.database.statementTimeoutMs,
        idle_in_transaction_session_timeout: Math.max(config.database.statementTimeoutMs, 60_000),
        application_name: 'nexora-api',
      },
      {
        onPoolError: (err) => {
          logger.warn({ err }, 'PostgreSQL pool error');
        },
      },
    );
    super({ adapter });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connections closed');
  }
}
