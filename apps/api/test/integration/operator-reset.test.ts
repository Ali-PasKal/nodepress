import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { PasswordHasher } from '../../src/modules/security/password-hasher.service.js';
import {
  OperatorResetError,
  operatorResetPassword,
} from '../../src/modules/users/operator-password-reset.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
} from '../helpers/identity.js';
import type { TestApp } from '../helpers/test-app.js';

describe('operator password reset (CLI recovery)', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    await resetIdentityData();
    testApp = await createIdentityApp();
    await install(testApp.server);
  });
  afterAll(() => testApp.close());

  it('sets a temporary password, signs the user out and audits the action', async () => {
    const before = await signIn(testApp.server, OWNER.email, OWNER.password);
    const prisma = testApp.app.get(PrismaService);
    const result = await operatorResetPassword(
      prisma,
      new PasswordHasher(),
      ' Owner@Example.TEST ',
    );
    expect(result.email).toBe(OWNER.email);
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);

    await before.agent.get('/api/v1/account/profile').expect(401);
    await signIn(testApp.server, OWNER.email, result.temporaryPassword);
    const audit = await withDb(
      async (db) =>
        (
          await db.query(
            `SELECT metadata FROM audit_events WHERE action = 'user.password_reset_by_operator'`,
          )
        ).rows as { metadata: unknown }[],
    );
    expect(audit).toEqual([{ metadata: { via: 'cli' } }]);
  });

  it('reports unknown users and invalid emails', async () => {
    const prisma = testApp.app.get(PrismaService);
    await expect(
      operatorResetPassword(prisma, new PasswordHasher(), 'ghost@example.test'),
    ).rejects.toBeInstanceOf(OperatorResetError);
    await expect(
      operatorResetPassword(prisma, new PasswordHasher(), 'not an email'),
    ).rejects.toThrow('valid email');
  });
});
