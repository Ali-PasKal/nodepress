import { fail, heading } from '../output.ts';
import { runSteps } from '../process.ts';

/** Loose shape check; the API script performs full validation. Also keeps arguments shell-safe. */
const EMAIL_SHAPE = /^[^\s@"'`;&|<>$]+@[^\s@"'`;&|<>$]+\.[^\s@"'`;&|<>$]+$/;

export async function userCommand(
  action: string | undefined,
  email: string | undefined,
): Promise<number> {
  if (action !== 'reset-password') {
    fail('Usage: nexora user reset-password --email <email>');
  }
  if (email === undefined || !EMAIL_SHAPE.test(email)) {
    fail('Provide a valid email address: nexora user reset-password --email <email>');
  }
  heading(`Resetting the password for ${email}`);
  return runSteps([
    ['pnpm', ['--filter', '@nexora/api', 'run', 'build']],
    // No `--` separator: pnpm 10 forwards it verbatim, and the script would then read `--email` as a positional.
    ['pnpm', ['--filter', '@nexora/api', 'run', 'user:reset-password', '--email', email]],
  ]);
}
