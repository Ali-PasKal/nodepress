import { readFileSync } from 'node:fs';
import { parseCommandLine } from './args.ts';
import { dev } from './commands/dev.ts';
import { doctor } from './commands/doctor.ts';
import { migrate } from './commands/migrate.ts';
import { pluginCommand } from './commands/plugin.ts';
import { userCommand } from './commands/user.ts';
import { color, fail } from './output.ts';
import { run, runSteps } from './process.ts';

const HELP = `${color.bold('nexora')} — NEXORA CMS developer CLI

${color.bold('Usage')}
  nexora <command> [options]

${color.bold('Commands')}
  dev [--no-infra]        Start PostgreSQL + Valkey (docker compose), apply migrations,
                          then run the API, site runtime and admin in watch mode
  build                   Build every package and app for production
  test [--e2e]            Run unit and integration tests (--e2e: Playwright end-to-end tests)
  lint                    Run ESLint and the Prettier format check
  typecheck               Type-check every workspace package
  migrate <action>        Database migrations:
                            deploy   apply pending migrations
                            status   show migration status
                            check    fail if the database schema drifts from schema.prisma
                            dev      create a migration from schema changes [--name <name>]
                            reset    drop and recreate the database (requires --force)
  user reset-password --email <email>
                          Account recovery: set a temporary password for a user
                          (signs them out everywhere; prints the password once)
  plugin check <folder>   Validate a plugin folder (manifest, main file, limits)
  plugin pack <folder> [--out <file.zip>]
                          Build the package to upload under Plugins in the admin
  doctor                  Check Node, pnpm, Docker, .env, database and cache connectivity
  help                    Show this help
  version                 Print the CLI version
`;

async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseCommandLine(argv);
  } catch (error) {
    fail(`${(error as Error).message}\nRun "nexora help" for usage.`);
  }
  const { command, positionals, flags } = parsed;
  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case 'help':
      console.log(HELP);
      return 0;
    case 'version': {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
      };
      console.log(pkg.version);
      return 0;
    }
    case 'dev':
      return dev({ infra: flags.infra });
    case 'build':
      return run('pnpm', ['run', 'build']);
    case 'test':
      return run('pnpm', ['run', flags.e2e ? 'test:e2e' : 'test']);
    case 'lint':
      return runSteps([
        ['pnpm', ['run', 'lint']],
        ['pnpm', ['run', 'format:check']],
      ]);
    case 'typecheck':
      return run('pnpm', ['run', 'typecheck']);
    case 'migrate':
      return migrate(positionals[0], {
        force: flags.force,
        ...(flags.name === undefined ? {} : { name: flags.name }),
      });
    case 'user':
      return userCommand(positionals[0], flags.email);
    case 'plugin':
      return pluginCommand(positionals[0], positionals[1], flags.out);
    case 'doctor':
      return doctor();
    default:
      fail(`Unknown command "${command}". Run "nexora help" for usage.`);
  }
}

process.exitCode = await main(process.argv.slice(2));
