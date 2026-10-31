import { emailSchema } from '@nexora/shared';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { generateToken } from '../security/crypto.js';
import type { PasswordHasher } from '../security/password-hasher.service.js';

export class OperatorResetError extends Error {}

/**
 * Account recovery for operators with server access (e.g. the only administrator is locked out and no
 * email transport is configured). Sets a random temporary password, signs the user out everywhere and
 * records an audit event. Returns the temporary password to show once.
 */
export async function operatorResetPassword(
  prisma: PrismaService,
  hasher: PasswordHasher,
  rawEmail: string,
): Promise<{ email: string; temporaryPassword: string }> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    throw new OperatorResetError('Enter a valid email address.');
  }
  const email = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    throw new OperatorResetError(`No user with email ${email}.`);
  }
  const temporaryPassword = generateToken(18);
  const passwordHash = await hasher.hash(temporaryPassword);
  await prisma.$transaction(async (tx) => {
    await tx.userCredential.upsert({
      where: { userId: user.id },
      create: { userId: user.id, passwordHash },
      update: { passwordHash },
    });
    await tx.user.update({ where: { id: user.id }, data: { passwordChangedAt: new Date() } });
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'password_reset' },
    });
    await tx.auditEvent.create({
      data: {
        action: 'user.password_reset_by_operator',
        targetType: 'user',
        targetId: user.id,
        metadata: { via: 'cli' },
      },
    });
  });
  return { email, temporaryPassword };
}
