import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { generateToken, sha256 } from '../security/crypto.js';

/**
 * Protects a freshly deployed, not-yet-installed instance from being claimed by whoever finds it first:
 * the setup wizard requires a one-time token that only the operator can see (server log or SETUP_TOKEN).
 * A new random token is generated on every start until installation completes.
 */
@Injectable()
export class SetupTokenService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Setup');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const state = await this.prisma.systemState.findUnique({
        where: { id: 1 },
        select: { installedAt: true },
      });
      if (state?.installedAt) {
        return;
      }
      const token = this.config.setup.token ?? generateToken(24);
      await this.prisma.systemState.upsert({
        where: { id: 1 },
        create: { id: 1, setupTokenHash: sha256(token) },
        update: { setupTokenHash: sha256(token) },
      });
      if (this.config.setup.token) {
        this.logger.log(
          'NEXORA is not installed yet. The setup wizard accepts the SETUP_TOKEN from the environment.',
        );
      } else {
        // Intentionally logged: this is how the operator receives the one-time token (single use,
        // useless once setup completes, regenerated on every restart until then).
        this.logger.warn(
          { setupToken: token },
          `NEXORA is not installed yet. Open /admin/setup and enter this one-time setup token: ${token}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        { err },
        'Could not prepare the setup token (is the database migrated?); retry after fixing it',
      );
    }
  }
}
