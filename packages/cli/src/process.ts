import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { color } from './output.ts';

/** Absolute path of the repository root (packages/cli/src → ../../..). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Runs a command with inherited stdio and resolves with its exit code. Arguments are passed as an
 * array (no shell), so nothing is ever interpolated into a shell command line.
 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<number> {
  console.log(color.dim(`$ ${[command, ...args].join(' ')}`));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

/** Runs steps in order and stops at the first failure, returning its exit code. */
export async function runSteps(
  steps: readonly (readonly [string, readonly string[]])[],
): Promise<number> {
  for (const [command, args] of steps) {
    const code = await run(command, args);
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

/** Resolves true if `command --version` exits successfully. */
export function isAvailable(
  command: string,
  args: readonly string[] = ['--version'],
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => {
      resolve(false);
    });
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}
