import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdentityApp,
  createUser,
  install,
  MAIL_DIR,
  nextIp,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
  type SignedIn,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';
import { JobWorker } from '../../src/modules/jobs/job-worker.service.js';

let worker: JobWorker | undefined;

/** Runs due background jobs (mail is sent by a job), then waits until `expected` emails exist, or ~1 s. */
async function waitForMail(expected = 1): Promise<{ to: string; subject: string; text: string }[]> {
  await worker?.drain();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const files = (await readdir(MAIL_DIR).catch(() => []))
      .filter((name) => name.endsWith('.json'))
      .sort();
    if (files.length >= expected) {
      return Promise.all(
        files.map(
          async (name) =>
            JSON.parse(await readFile(join(MAIL_DIR, name), 'utf8')) as {
              to: string;
              subject: string;
              text: string;
            },
        ),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}

function tokenFrom(text: string): string {
  const match = /reset-password\?token=([A-Za-z0-9_%-]+)/.exec(text);
  if (!match?.[1]) throw new Error('no reset link in email');
  return decodeURIComponent(match[1]);
}

describe('password reset', () => {
  let testApp: TestApp;
  let user: { id: string; email: string; password: string };
  let owner: SignedIn;

  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    worker = testApp.app.get(JobWorker);
    await install(testApp.server);
    owner = await signIn(testApp.server, OWNER.email, OWNER.password);
    user = await createUser(owner, 'editor');
  });
  beforeEach(async () => {
    await rm(MAIL_DIR, { recursive: true, force: true });
  });
  afterAll(() => testApp.close());

  const requestReset = (email: string) =>
    request(testApp.server)
      .post('/api/v1/auth/password-reset/request')
      .set('X-Forwarded-For', nextIp())
      .send({ email });

  it('answers identically for known and unknown accounts, and only emails real ones', async () => {
    const unknown = await requestReset('nobody@example.test').expect(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await waitForMail()).toEqual([]);
    const known = await requestReset(user.email).expect(202);
    expect(known.body).toEqual(unknown.body);
    const [mail] = await waitForMail();
    expect(mail?.to).toBe(user.email);
    expect(mail?.text).toContain('https://site.example.test/admin/reset-password?token=');
  });

  it('resets the password once, stores only a hash, and signs out existing sessions', async () => {
    const existing = await signIn(testApp.server, user.email, user.password);
    await requestReset(user.email).expect(202);
    const [mail] = await waitForMail();
    const token = tokenFrom(mail!.text);

    const stored = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT encode(token_hash, 'hex') AS h FROM password_reset_tokens WHERE used_at IS NULL`,
          )
        ).rows as { h: string }[],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.h).not.toContain(Buffer.from(token).toString('hex'));

    const newPassword = 'a brand new passphrase 456';
    await request(testApp.server)
      .post('/api/v1/auth/password-reset/confirm')
      .set('X-Forwarded-For', nextIp())
      .send({ token, password: newPassword })
      .expect(204);
    await existing.agent.get('/api/v1/account/profile').expect(401);
    await signIn(testApp.server, user.email, newPassword);
    user = { ...user, password: newPassword };

    const reuse = await request(testApp.server)
      .post('/api/v1/auth/password-reset/confirm')
      .set('X-Forwarded-For', nextIp())
      .send({ token, password: 'yet another passphrase' })
      .expect(400);
    expect(reuse.body.error.message).toMatch(/invalid or has expired/);
  });

  it('rejects expired, superseded and malformed tokens and weak passwords', async () => {
    // A fresh account: the per-account limit (3 requests/hour) would silently drop further requests.
    const user = await createUser(owner, 'author');
    await requestReset(user.email).expect(202);
    const [first] = await waitForMail();
    await rm(MAIL_DIR, { recursive: true, force: true });
    await requestReset(user.email).expect(202);
    const [second] = await waitForMail();

    // The older link was superseded by the newer one.
    await request(testApp.server)
      .post('/api/v1/auth/password-reset/confirm')
      .set('X-Forwarded-For', nextIp())
      .send({ token: tokenFrom(first!.text), password: 'some valid passphrase' })
      .expect(400);
    const weak = await request(testApp.server)
      .post('/api/v1/auth/password-reset/confirm')
      .set('X-Forwarded-For', nextIp())
      .send({ token: tokenFrom(second!.text), password: 'short' })
      .expect(422);
    expect(weak.body.error.issues[0].path).toBe('password');

    await withDb((db) =>
      db.query(
        `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`,
      ),
    );
    await request(testApp.server)
      .post('/api/v1/auth/password-reset/confirm')
      .set('X-Forwarded-For', nextIp())
      .send({ token: tokenFrom(second!.text), password: 'some valid passphrase' })
      .expect(400);
    await request(testApp.server)
      .post('/api/v1/auth/password-reset/confirm')
      .set('X-Forwarded-For', nextIp())
      .send({ token: 'x'.repeat(43), password: 'some valid passphrase' })
      .expect(400);
  });

  it('silently stops emailing an account after 3 requests per hour', async () => {
    const target = await createUser(owner, 'viewer');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await requestReset(target.email).expect(202);
    }
    expect(await waitForMail(3)).toHaveLength(3);
    await rm(MAIL_DIR, { recursive: true, force: true });
    const fourth = await requestReset(target.email).expect(202);
    expect(fourth.body.message).toMatch(/If an account exists/);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await waitForMail()).toEqual([]);
  });
});
