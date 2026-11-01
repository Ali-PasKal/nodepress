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
    // Shared contracts and the themes (the API reads theme manifests; the site renders with them).
    ['pnpm', ['--filter', '@nexora/theme-starter...', 'run', 'build']],
    ['pnpm', ['--filter', '@nexora/api', 'exec', 'prisma', 'migrate', 'deploy']],
  ]);
  if (prepared !== 0) {
    return prepared;
  }

  heading(
    'Starting API (:3000), site runtime (:4321) and admin — open http://localhost:5173/ (site) and http://localhost:5173/admin/',
  );
  return run('pnpm', [
    '--parallel',
    '--filter',
    '@nexora/shared',
    '--filter',
    '@nexora/theme-sdk',
    '--filter',
    '@nexora/theme-starter',
    '--filter',
    '@nexora/api',
    '--filter',
    '@nexora/site-runtime',
    '--filter',
    '@nexora/admin',
    'run',
    'dev',
  ]);
}
