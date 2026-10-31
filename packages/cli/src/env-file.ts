import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { REPO_ROOT } from './process.ts';

export const ENV_FILE = join(REPO_ROOT, '.env');
export const ENV_EXAMPLE_FILE = join(REPO_ROOT, '.env.example');

/** Reads the repository .env file without modifying process.env. Returns null if it does not exist. */
export function readEnvFile(path: string = ENV_FILE): Record<string, string> | null {
  if (!existsSync(path)) {
    return null;
  }
  return parseEnv(readFileSync(path, 'utf8')) as Record<string, string>;
}

/** Effective configuration: real environment variables take precedence over the .env file. */
export function effectiveEnv(
  fileEnv: Record<string, string> | null,
): Record<string, string | undefined> {
  return { ...(fileEnv ?? {}), ...process.env };
}
