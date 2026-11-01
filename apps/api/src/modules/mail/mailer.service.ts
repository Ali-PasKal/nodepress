import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { defineJob } from '../jobs/job-definition.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { JobRegistry } from '../jobs/job-registry.service.js';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export const SendMailJob = defineJob(
  'mail.send',
  z.object({
    to: z.string().min(3).max(320),
    subject: z.string().min(1).max(300),
    text: z.string().min(1).max(100_000),
  }),
);

/**
 * Outgoing mail.
 * - `smtp`: the production transport (TLS enforced in production by configuration validation);
 * - `log`: writes the message (including links) to the application log (development only);
 * - `file`: writes one JSON file per message to MAIL_FILE_DIR, mode 0600 (development and tests);
 * - `disabled`: drops messages with a warning.
 *
 * Callers normally use `enqueue` so delivery is durable and retried; `send` delivers immediately and is
 * used by job handlers.
 */
@Injectable()
export class Mailer implements OnModuleInit {
  private readonly logger = new Logger(Mailer.name);
  private transporter: Transporter | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: JobRegistry,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.registry.register(SendMailJob, (message) => this.send(message), {
      maxAttempts: 8,
      timeoutMs: 60_000,
    });
  }

  /** Durable delivery: the message is sent by a background job after the transaction commits. */
  async enqueue(db: DbClient, message: MailMessage): Promise<void> {
    await this.queue.enqueue(db, SendMailJob, message);
  }

  async send(message: MailMessage): Promise<void> {
    const { transport, fileDir, from } = this.config.mail;
    switch (transport) {
      case 'smtp': {
        await this.smtp().sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
        return;
      }
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

  private smtp(): Transporter {
    const smtp = this.config.mail.smtp;
    if (!smtp) {
      throw new Error('SMTP transport selected without SMTP settings');
    }
    this.transporter ??= nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure && smtp.requireTls,
      ignoreTLS: !smtp.secure && !smtp.requireTls,
      tls: { rejectUnauthorized: smtp.rejectUnauthorized },
      ...(smtp.user !== null && smtp.password !== null
        ? { auth: { user: smtp.user, pass: smtp.password } }
        : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return this.transporter;
  }
}
