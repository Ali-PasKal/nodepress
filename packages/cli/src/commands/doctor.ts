import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveEnv, readEnvFile } from '../env-file.ts';
import { color, heading } from '../output.ts';
import { isAvailable, REPO_ROOT } from '../process.ts';

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  readonly name: string;
  readonly level: CheckLevel;
  readonly detail: string;
}

/** Compares dotted numeric versions: returns true if `actual` >= `minimum`. */
export function satisfiesMinimum(actual: string, minimum: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(actual);
  const m = parse(minimum);
  for (let index = 0; index < Math.max(a.length, m.length); index += 1) {
    const difference = (a[index] ?? 0) - (m[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return true;
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
  const minimumNode = rootPackage.engines.node.replace(/^>=\s*/, '');
  results.push({
    name: 'Node.js',
    level: satisfiesMinimum(process.versions.node, minimumNode) ? 'ok' : 'fail',
    detail: `${process.versions.node} (requires >= ${minimumNode})`,
  });

  results.push({
    name: 'pnpm',
    level: (await isAvailable('pnpm')) ? 'ok' : 'fail',
    detail: 'required to install dependencies and run workspace scripts',
  });

  const docker = await isAvailable('docker', ['compose', 'version']);
  results.push({
    name: 'Docker Compose',
    level: docker ? 'ok' : 'warn',
    detail: docker
      ? 'available'
      : 'not available; provide PostgreSQL yourself and run "nexora dev --no-infra"',
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
