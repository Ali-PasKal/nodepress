import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { simpleParser } from 'mailparser';
import request from 'supertest';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobWorker } from '../../src/modules/jobs/job-worker.service.js';
import {
  createIdentityApp,
  createUser,
  install,
  nextIp,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

interface Received {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly secure: boolean;
  readonly user: string | undefined;
}

async function startSmtp(options: SMTPServerOptions): Promise<{
  port: number;
  received: Received[];
  close: () => Promise<void>;
}> {
  const received: Received[] = [];
  const server = new SMTPServer({
    logger: false,
    ...options,
    onData(stream, session, callback) {
      simpleParser(stream)
        .then((mail) => {
          received.push({
            to: session.envelope.rcptTo.map((rcpt) => rcpt.address).join(','),
            subject: mail.subject ?? '',
            text: mail.text ?? '',
            secure: session.secure,
            user: typeof session.user === 'string' ? session.user : undefined,
          });
          callback();
        })
        .catch((err: unknown) => {
          callback(err as Error);
        });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server.server, 'listening');
  const { port } = server.server.address() as AddressInfo;
  return {
    port,
    received,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

async function requestReset(app: TestApp, email: string): Promise<void> {
  await request(app.server)
    .post('/api/v1/auth/password-reset/request')
    .set('X-Forwarded-For', nextIp())
    .send({ email })
    .expect(202);
}

describe('mail delivery over SMTP', () => {
  let user: { id: string; email: string; password: string };
  beforeAll(async () => {
    await resetIdentityData();
    const setupApp = await createIdentityApp();
    try {
      await install(setupApp.server);
      const owner = await signIn(setupApp.server, OWNER.email, OWNER.password);
      user = await createUser(owner, 'author');
    } finally {
      await setupApp.close();
    }
  });

  let smtp: Awaited<ReturnType<typeof startSmtp>>;
  afterAll(async () => {
    await smtp.close();
  });

  it('delivers password reset email through a job whose payload never contains the token', async () => {
    smtp = await startSmtp({ authOptional: true, disabledCommands: ['STARTTLS'] });
    const app = await createIdentityApp({
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_REQUIRE_TLS: 'false',
      MAIL_FROM: 'Test Site <no-reply@site.example.test>',
    });
    try {
      await requestReset(app, user.email);
      const jobs = await withDb(
        async (db) =>
          (
            await db.query(
              `SELECT payload FROM jobs WHERE name = 'auth.password_reset_email' AND status = 'pending'`,
            )
          ).rows as { payload: Record<string, unknown> }[],
      );
      expect(jobs).toEqual([{ payload: { userId: user.id } }]);
      // Nothing is sent until the job runs.
      expect(smtp.received).toEqual([]);
      expect(await app.app.get(JobWorker).drain()).toBe(1);

      expect(smtp.received).toHaveLength(1);
      const [mail] = smtp.received;
      expect(mail).toMatchObject({ to: user.email, subject: 'Reset your Test Site password' });
      const token = decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(mail!.text)![1]!);
      await request(app.server)
        .post('/api/v1/auth/password-reset/confirm')
        .set('X-Forwarded-For', nextIp())
        .send({ token, password: 'a new password via smtp' })
        .expect(204);
      user.password = 'a new password via smtp';
    } finally {
      await app.close();
    }
  });

  it('upgrades with STARTTLS and authenticates', async () => {
    const tls = await startSmtp({
      allowInsecureAuth: false,
      authMethods: ['PLAIN', 'LOGIN'],
      onAuth(auth, _session, callback) {
        if (auth.username === 'mailer' && auth.password === 'smtp-secret') {
          callback(null, { user: 'mailer' });
        } else {
          callback(new Error('Invalid credentials'));
        }
      },
    });
    const app = await createIdentityApp({
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(tls.port),
      SMTP_REQUIRE_TLS: 'true',
      // smtp-server presents a self-signed certificate; verification stays mandatory in production.
      SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'smtp-secret',
    });
    try {
      await requestReset(app, user.email);
      await app.app.get(JobWorker).drain();
      expect(tls.received).toHaveLength(1);
      expect(tls.received[0]).toMatchObject({ secure: true, user: 'mailer', to: user.email });
    } finally {
      await app.close();
      await tls.close();
    }
  });

  it('refuses to send in plain text when TLS is required, and retries later', async () => {
    const plain = await startSmtp({ authOptional: true, disabledCommands: ['STARTTLS'] });
    const app = await createIdentityApp({
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(plain.port),
      SMTP_REQUIRE_TLS: 'true',
    });
    try {
      await requestReset(app, user.email);
      await app.app.get(JobWorker).drain();
      expect(plain.received).toEqual([]);
      const [job] = await withDb(
        async (db) =>
          (
            await db.query(
              `SELECT status, attempts, last_error FROM jobs
                WHERE name = 'auth.password_reset_email' ORDER BY created_at DESC LIMIT 1`,
            )
          ).rows as { status: string; attempts: number; last_error: string }[],
      );
      expect(job).toMatchObject({ status: 'pending', attempts: 1 });
      expect(job!.last_error).toMatch(/STARTTLS/i);
    } finally {
      await app.close();
      await plain.close();
    }
  });
});
