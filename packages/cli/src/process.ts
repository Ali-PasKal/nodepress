import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color } from './output.ts';

/** Absolute path of the repository root (packages/cli/src → ../../..). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface ResolvedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
}

/**
 * Resolves how to launch a command portably.
 *
 * On Windows, `pnpm` is a `.cmd` shim, which Node cannot spawn without a shell. When the CLI runs
 * through `pnpm nexora`, pnpm exposes its own entry point in `npm_execpath`, so we launch it with the
 * current Node binary instead: no shell on any platform. The shell fallback (Windows only, when the CLI
 * is invoked outside pnpm) is safe because callers only pass fixed or validated arguments.
 */
export function resolveCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand {
  if (command === 'pnpm') {
    const execPath = env.npm_execpath;
    if (execPath && /pnpm/i.test(execPath)) {
      return ['.js', '.cjs', '.mjs'].includes(extname(execPath).toLowerCase())
        ? { command: process.execPath, args: [execPath, ...args], shell: false }
        : { command: execPath, args, shell: false };
    }
    if (platform === 'win32') {
      return { command: 'pnpm.cmd', args, shell: true };
    }
  }
  return { command, args, shell: false };
}

/**
 * Runs a command with inherited stdio and resolves with its exit code. Arguments are passed as an
 * array (no shell, except the documented Windows fallback in resolveCommand).
 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<number> {
  console.log(color.dim(`$ ${[command, ...args].join(' ')}`));
  return new Promise((resolve, reject) => {
    const resolved = resolveCommand(command, args, options.env ?? process.env);
    const child = spawn(resolved.command, resolved.args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: resolved.shell,
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
  const resolved = resolveCommand(command, args);
  return new Promise((resolve) => {
    const child = spawn(resolved.command, resolved.args, {
      stdio: 'ignore',
      shell: resolved.shell,
    });
    child.on('error', () => {
      resolve(false);
    });
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}
