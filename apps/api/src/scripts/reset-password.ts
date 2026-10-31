/**
 * Operator account recovery. Usage (from the repository root):
 *   pnpm nexora user reset-password --email admin@example.com
 * Requires DATABASE_URL (read from the environment or the repository .env file).
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../config/env.schema.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { PasswordHasher } from '../modules/security/password-hasher.service.js';
import {
  OperatorResetError,
  operatorResetPassword,
} from '../modules/users/operator-password-reset.js';

// `pnpm run user:reset-password -- --email x` forwards the `--` verbatim; drop it so --email still parses.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: { email: { type: 'string' } },
  strict: true,
});
if (!values.email) {
  console.error('Usage: reset-password --email <email>');
  process.exit(2);
}

const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const prisma = new PrismaService(config);
try {
  const result = await operatorResetPassword(prisma, new PasswordHasher(), values.email);
  console.warn(
    [
      `Temporary password for ${result.email}:`,
      '',
      `  ${result.temporaryPassword}`,
      '',
      "All of this user's sessions were signed out. Sign in with this password and change it immediately",
      '(Profile → Change password). It is shown only once.',
    ].join('\n'),
  );
} catch (error) {
  console.error(error instanceof OperatorResetError ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
