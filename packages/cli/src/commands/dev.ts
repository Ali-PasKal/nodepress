import { copyFileSync, existsSync } from 'node:fs';
import { ENV_EXAMPLE_FILE, ENV_FILE } from '../env-file.ts';
import { color, fail, heading } from '../output.ts';
import { describeDockerProblem, detectDocker } from '../docker.ts';
import { run, runSteps } from '../process.ts';

export async function dev(options: { infra: boolean }): Promise<number> {
  // Check prerequisites before touching the workspace.
  if (options.infra) {
    const docker = await detectDocker();
    if (docker !== 'ready') {
      fail(describeDockerProblem(docker));
    }
  }

  if (!existsSync(ENV_FILE)) {
    copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
    console.log(`${color.yellow('!')} Created .env from .env.example (development defaults only).`);
  }

  if (options.infra) {
    heading('Starting PostgreSQL and Valkey (docker compose)');
    const code = await run('docker', ['compose', 'up', '--detach', '--wait', 'postgres', 'valkey']);
    if (code !== 0) {
      return code;
    }
  }

  heading('Preparing workspace');
  const prepared = await runSteps([
    ['pnpm', ['--filter', '@nexora/shared', 'run', 'build']],
    ['pnpm', ['--filter', '@nexora/api', 'exec', 'prisma', 'migrate', 'deploy']],
  ]);
  if (prepared !== 0) {
    return prepared;
  }

  heading('Starting API (http://localhost:3000) and admin (http://localhost:5173/admin/)');
  return run('pnpm', [
    '--parallel',
    '--filter',
    '@nexora/shared',
    '--filter',
    '@nexora/api',
    '--filter',
    '@nexora/admin',
    'run',
    'dev',
  ]);
}
