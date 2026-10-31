import { isAvailable } from './process.ts';

export type DockerState = 'ready' | 'missing' | 'no-compose' | 'engine-stopped';

/** Upper bound for `docker info`, which can hang while Docker Desktop is starting. */
const ENGINE_CHECK_TIMEOUT_MS = 15_000;

/**
 * Distinguishes the ways Docker can be unusable, because each needs a different fix:
 * not installed / not on PATH, no Compose v2 plugin, or installed but the engine is not running.
 */
export async function detectDocker(): Promise<DockerState> {
  if (!(await isAvailable('docker', ['--version']))) {
    return 'missing';
  }
  if (!(await isAvailable('docker', ['compose', 'version']))) {
    return 'no-compose';
  }
  if (!(await isAvailable('docker', ['info'], ENGINE_CHECK_TIMEOUT_MS))) {
    return 'engine-stopped';
  }
  return 'ready';
}

const NO_DOCKER_ALTERNATIVE =
  'Alternatively, run PostgreSQL yourself (matching DATABASE_URL in .env) and use "pnpm nexora dev --no-infra".';

export function describeDockerProblem(state: Exclude<DockerState, 'ready'>): string {
  switch (state) {
    case 'missing':
      return `Docker was not found on PATH. Install Docker Desktop (https://www.docker.com/products/docker-desktop/), then open a NEW terminal so PATH is refreshed. ${NO_DOCKER_ALTERNATIVE}`;
    case 'no-compose':
      return `Docker is installed, but the Compose v2 plugin ("docker compose") is missing. Update Docker Desktop, or install the docker-compose-plugin package. ${NO_DOCKER_ALTERNATIVE}`;
    case 'engine-stopped':
      return `Docker is installed, but its engine is not running. Start Docker Desktop, wait until it reports "Engine running", then retry. ${NO_DOCKER_ALTERNATIVE}`;
  }
}
