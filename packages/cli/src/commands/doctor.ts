import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveEnv, readEnvFile } from '../env-file.ts';
import { color, heading } from '../output.ts';
import { describeDockerProblem, detectDocker } from '../docker.ts';
import { isAvailable, REPO_ROOT } from '../process.ts';

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  readonly name: string;
  readonly level: CheckLevel;
  readonly detail: string;
}

type Version = readonly [number, number, number];

function parseVersion(value: string): Version | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Minimal semver range check for the syntax used in `engines` fields: alternatives separated by `||`,
 * each a space-separated list of comparators (`^x.y.z`, `>=`, `>`, `<=`, `<`, `=` or a bare version).
 * Unknown syntax never matches, so a malformed range fails loudly instead of passing silently.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const actual = parseVersion(version);
  if (actual === null) {
    return false;
  }
  return range.split('||').some((alternative) => {
    const comparators = alternative
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);
    return (
      comparators.length > 0 &&
      comparators.every((comparator) => satisfiesComparator(actual, comparator))
    );
  });
}

function satisfiesComparator(actual: Version, comparator: string): boolean {
  const match = /^(\^|>=|<=|>|<|=)?(v?\d+(?:\.\d+){0,2})$/.exec(comparator);
  const target = match?.[2] === undefined ? null : parseVersion(match[2]);
  if (!match || target === null) {
    return false;
  }
  const order = compareVersions(actual, target);
  switch (match[1]) {
    case '^':
      // ^X.Y.Z (X > 0): at least X.Y.Z, below the next major version.
      return order >= 0 && actual[0] === target[0];
    case '>=':
      return order >= 0;
    case '>':
      return order > 0;
    case '<=':
      return order <= 0;
    case '<':
      return order < 0;
    default:
      return order === 0;
  }
}

/**
 * Node.js check: outside the supported range fails; inside it, odd-numbered (non-LTS) releases get a
 * warning because they reach end-of-life quickly and some tools declare them unsupported.
 */
export function checkNodeVersion(version: string, supportedRange: string): CheckResult {
  if (!satisfiesRange(version, supportedRange)) {
    return {
      name: 'Node.js',
      level: 'fail',
      detail: `${version} is not supported (${supportedRange}); install Node.js 22 or 24 LTS`,
    };
  }
  const major = Number.parseInt(version.replace(/^v/, ''), 10);
  if (major % 2 === 1) {
    return {
      name: 'Node.js',
      level: 'warn',
      detail: `${version} works, but is not an LTS release (no long-term security fixes); Node.js 22 or 24 LTS is recommended`,
    };
  }
  return { name: 'Node.js', level: 'ok', detail: `${version} (supported: ${supportedRange})` };
}

/** Extracts host and port from a service URL, applying the protocol's default port. */
export function endpointOf(
  url: string,
  defaultPort: number,
): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === '') {
      return null;
    }
    return {
      host: parsed.hostname.replace(/^\[|\]$/g, ''),
      port: parsed.port ? Number(parsed.port) : defaultPort,
    };
  } catch {
    return null;
  }
}

function canConnect(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => {
      done(false);
    });
    socket.once('connect', () => {
      done(true);
    });
    socket.once('error', () => {
      done(false);
    });
  });
}

async function checkService(
  name: string,
  url: string | undefined,
  defaultPort: number,
  required: boolean,
): Promise<CheckResult> {
  if (url === undefined || url === '') {
    return required
      ? { name, level: 'fail', detail: 'not configured' }
      : { name, level: 'ok', detail: 'not configured (optional)' };
  }
  const endpoint = endpointOf(url, defaultPort);
  if (endpoint === null) {
    return { name, level: 'fail', detail: 'URL is not valid' };
  }
  const reachable = await canConnect(endpoint.host, endpoint.port);
  const where = `${endpoint.host}:${String(endpoint.port)}`;
  if (reachable) {
    return { name, level: 'ok', detail: `reachable at ${where}` };
  }
  return {
    name,
    level: required ? 'fail' : 'warn',
    detail: `cannot connect to ${where} (is it running? try "docker compose up -d")`,
  };
}

export async function runDoctorChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    engines: { node: string };
  };
  results.push(checkNodeVersion(process.versions.node, rootPackage.engines.node));

  results.push({
    name: 'pnpm',
    level: (await isAvailable('pnpm')) ? 'ok' : 'fail',
    detail: 'required to install dependencies and run workspace scripts',
  });

  const docker = await detectDocker();
  results.push({
    name: 'Docker',
    level: docker === 'ready' ? 'ok' : 'warn',
    detail:
      docker === 'ready' ? 'engine running, Compose v2 available' : describeDockerProblem(docker),
  });

  const fileEnv = readEnvFile();
  results.push({
    name: '.env file',
    level: fileEnv ? 'ok' : 'warn',
    detail: fileEnv
      ? 'present'
      : 'missing; copy .env.example to .env (nexora dev does this automatically)',
  });

  const env = effectiveEnv(fileEnv);
  results.push(await checkService('PostgreSQL', env.DATABASE_URL, 5432, true));
  results.push(await checkService('Cache (Redis/Valkey)', env.REDIS_URL, 6379, false));
  return results;
}

export async function doctor(): Promise<number> {
  heading('NEXORA environment check');
  const results = await runDoctorChecks();
  const symbol: Record<CheckLevel, string> = {
    ok: color.green('✓'),
    warn: color.yellow('!'),
    fail: color.red('✗'),
  };
  for (const result of results) {
    console.log(`  ${symbol[result.level]} ${result.name.padEnd(22)} ${color.dim(result.detail)}`);
  }
  const failures = results.filter((result) => result.level === 'fail').length;
  console.log(
    failures === 0
      ? `\n${color.green('Environment looks good.')}`
      : `\n${color.red(`${String(failures)} check(s) failed.`)}`,
  );
  return failures === 0 ? 0 : 1;
}
