import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Outgoing mail. Development transports only in this milestone:
 * - `log`: writes the message (including links) to the application log;
 * - `file`: writes one JSON file per message to MAIL_FILE_DIR (mode 0600);
 * - `disabled`: drops messages with a warning (production default until SMTP + the job queue land in M3).
 * Configuration validation forbids `log` and `file` in production.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(message: MailMessage): Promise<void> {
    const { transport, fileDir, from } = this.config.mail;
    switch (transport) {
      case 'log':
        this.logger.log({ mail: { from, ...message } }, `Email to ${message.to} (log transport)`);
        return;
      case 'file': {
        await mkdir(fileDir, { recursive: true, mode: 0o700 });
        const name = `${String(Date.now())}-${randomBytes(4).toString('hex')}.json`;
        const body = JSON.stringify(
          { from, ...message, createdAt: new Date().toISOString() },
          null,
          2,
        );
        await writeFile(join(fileDir, name), body, { mode: 0o600 });
        return;
      }
      case 'disabled':
        this.logger.warn(
          { subject: message.subject },
          'Email delivery is not configured; message was not sent',
        );
        return;
    }
  }

  /**
   * Sends without delaying the HTTP response (so response time does not reveal whether a message was
   * sent). Not durable: a crash before delivery loses the message. Replaced by the job queue in M3.
   */
  sendInBackground(message: MailMessage): void {
    setImmediate(() => {
      this.send(message).catch((err: unknown) => {
        this.logger.error({ err, subject: message.subject }, 'Failed to send email');
      });
    });
  }
}
