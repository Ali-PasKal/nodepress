import { effectiveEnv, readEnvFile } from '../env-file.ts';
import { fail, heading } from '../output.ts';
import { run } from '../process.ts';

const MIGRATION_NAME = /^[A-Za-z0-9_]{1,100}$/;

export const MIGRATE_ACTIONS = ['deploy', 'status', 'dev', 'reset', 'check'] as const;
export type MigrateAction = (typeof MIGRATE_ACTIONS)[number];

export function isMigrateAction(value: string | undefined): value is MigrateAction {
  return MIGRATE_ACTIONS.includes(value as MigrateAction);
}

const prisma = (...args: string[]) => ['--filter', '@nexora/api', 'exec', 'prisma', ...args];

export async function migrate(
  action: string | undefined,
  options: { force: boolean; name?: string },
): Promise<number> {
  if (!isMigrateAction(action)) {
    fail(`Usage: nexora migrate <${MIGRATE_ACTIONS.join('|')}>`);
  }
  const nodeEnv = effectiveEnv(readEnvFile()).NODE_ENV;
  const destructive = action === 'reset' || action === 'dev';
  if (destructive && nodeEnv === 'production') {
    fail(
      `"nexora migrate ${action}" is disabled when NODE_ENV=production. Use "nexora migrate deploy".`,
    );
  }

  switch (action) {
    case 'deploy':
      heading('Applying pending migrations');
      return run('pnpm', prisma('migrate', 'deploy'));
    case 'status':
      return run('pnpm', prisma('migrate', 'status'));
    case 'check':
      heading('Checking that the database schema matches schema.prisma');
      return run('pnpm', ['--filter', '@nexora/api', 'run', 'db:check-drift']);
    case 'dev': {
      if (options.name !== undefined && !MIGRATION_NAME.test(options.name)) {
        fail('Migration names may only contain letters, digits and underscores (e.g. add_users).');
      }
      heading('Creating a new migration from schema.prisma changes');
      const args = prisma('migrate', 'dev');
      if (options.name) {
        args.push('--name', options.name);
      }
      return run('pnpm', args);
    }
    case 'reset':
      if (!options.force) {
        fail(
          '"nexora migrate reset" drops ALL data in the configured database. Re-run with --force to confirm.',
        );
      }
      heading('Resetting the database (all data will be lost)');
      return run('pnpm', prisma('migrate', 'reset', '--force'));
  }
}
