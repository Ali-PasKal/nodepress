import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
  EngineLimits,
  HostCallHandler,
  Invocation,
  InvocationResult,
  LogLine,
} from './engine.js';
import type { ParentMessage } from './protocol.js';

/**
 * Parent side of a plugin's sandbox: starts the child process, sends it one invocation at a time, answers its
 * host calls through the caller's handler, and enforces what the child cannot be trusted to enforce itself —
 * a wall-clock watchdog per invocation (the child is killed when it overruns), strict validation of every
 * message, and a clean restart after a crash.
 */

export interface PluginProcessOptions {
  /** The plugin's JavaScript. */
  readonly code: string;
  readonly limits?: Partial<EngineLimits>;
  /** Path of the compiled sandbox entry (defaults to this package's `host.js`). */
  readonly hostPath?: string;
  readonly startTimeoutMs?: number;
  /** Extra time past an invocation's own deadline before the child is killed. */
  readonly graceMs?: number;
  /** V8 heap of the sandbox process (the plugin's memory is the separate WebAssembly memory). */
  readonly heapMegabytes?: number;
  /** Called when the child exits unexpectedly (crash, watchdog, protocol violation). */
  readonly onExit?: (reason: string) => void;
}

export interface InvocationOutcome {
  readonly result: InvocationResult;
  readonly logs: readonly LogLine[];
}

export class SandboxUnavailableError extends Error {
  override readonly name = 'SandboxUnavailableError';
}

const logLineSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  message: z.string().max(10_000),
});
const resultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(['timeout', 'out_of_memory', 'limit', 'plugin_error', 'invalid_result']),
      message: z.string().max(10_000),
    }),
  }),
]);
const childMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('call'),
    id: z.number().int(),
    callId: z.number().int(),
    method: z.string().max(64),
    args: z.array(z.unknown()).max(10),
  }),
  z.object({
    type: z.literal('result'),
    id: z.number().int(),
    result: resultSchema,
    logs: z.array(logLineSchema).max(100),
  }),
  z.object({ type: z.literal('fatal'), message: z.string().max(10_000) }),
]);

function packageRoot(file: string, name: string): string {
  let directory = dirname(realpathSync(file));
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
      if (parsed.name === name) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Package ${name} not found above ${file}.`);
    directory = parent;
  }
}

/**
 * Directories the sandbox process may read: its own package and the engine's packages. Nothing else — not
 * the application, its configuration or other dependencies.
 */
export function sandboxReadPaths(hostPath: string): string[] {
  const runtimeRoot = packageRoot(hostPath, '@nexora/plugin-runtime');
  const require = createRequire(join(runtimeRoot, 'package.json'));
  const core = require.resolve('quickjs-emscripten-core');
  const variant = require.resolve('@jitl/quickjs-wasmfile-release-sync');
  const ffi = createRequire(core).resolve('@jitl/quickjs-ffi-types');
  const roots: [string, string][] = [
    [realpathSync(runtimeRoot), '@nexora/plugin-runtime'],
    [packageRoot(core, 'quickjs-emscripten-core'), 'quickjs-emscripten-core'],
    [
      packageRoot(variant, '@jitl/quickjs-wasmfile-release-sync'),
      '@jitl/quickjs-wasmfile-release-sync',
    ],
    [packageRoot(ffi, '@jitl/quickjs-ffi-types'), '@jitl/quickjs-ffi-types'],
  ];
  // A package installed by pnpm reaches its dependencies through symlinks in the `node_modules` folder that
  // contains it (its own store entry); the permission model checks those link paths, so that folder is
  // allowed too. In a source checkout the runtime package keeps its links inside its own folder.
  const paths = roots.map(([root, name]) => {
    const container = name.startsWith('@') ? dirname(dirname(root)) : dirname(root);
    return basename(container) === 'node_modules' ? container : root;
  });
  return [...new Set(paths)];
}

export function defaultHostPath(): string {
  return fileURLToPath(new URL('./host.js', import.meta.url));
}

/** Node flags of the sandbox process. */
export function sandboxExecArgv(hostPath: string, heapMegabytes: number): string[] {
  return [
    // Node's permission model: no filesystem writes, no child processes, workers, native addons or WASI,
    // and reads only from the packages the sandbox consists of.
    '--permission',
    ...sandboxReadPaths(hostPath).map((path) => `--allow-fs-read=${path}`),
    `--max-old-space-size=${String(heapMegabytes)}`,
    // The host code never needs eval; plugin code runs inside the engine, not in V8.
    '--disallow-code-generation-from-strings',
  ];
}

interface Pending {
  readonly resolve: (outcome: InvocationOutcome) => void;
  readonly onCall: HostCallHandler;
  readonly timer: NodeJS.Timeout;
}

export class PluginProcess {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stopped = false;

  constructor(private readonly options: PluginProcessOptions) {}

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  /** The child's process id (for tests and diagnostics). */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Starts the sandbox process (idempotent; invocations start it on demand). */
  start(): Promise<void> {
    if (this.stopped)
      return Promise.reject(new SandboxUnavailableError('The sandbox was stopped.'));
    if (this.running && !this.starting) return Promise.resolve();
    this.starting ??= this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private spawn(): Promise<void> {
    const hostPath = this.options.hostPath ?? defaultHostPath();
    const child = fork(hostPath, [], {
      // An empty environment: no database URL, secrets or proxy settings reach the sandbox.
      env: {},
      execArgv: sandboxExecArgv(hostPath, this.options.heapMegabytes ?? 64),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'json',
    });
    this.child = child;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString('utf8');
    });
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        this.kill(child, 'The sandbox did not start in time.');
        reject(new SandboxUnavailableError('The sandbox did not start in time.'));
      }, this.options.startTimeoutMs ?? 10_000);
      child.on('message', (raw: unknown) => {
        const parsed = childMessageSchema.safeParse(raw);
        if (!parsed.success) {
          this.kill(child, 'The sandbox sent an invalid message.');
          return;
        }
        const message = parsed.data;
        if (message.type === 'ready') {
          if (ready) return;
          ready = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === 'fatal') {
          this.kill(child, `The sandbox failed: ${message.message}`);
          return;
        }
        if (message.type === 'call') {
          this.answerCall(child, message.id, message.callId, message.method, message.args);
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve({ result: message.result, logs: message.logs });
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        const reason =
          stderr.trim() !== ''
            ? `The sandbox exited (${String(signal ?? code)}): ${stderr.trim().slice(0, 500)}`
            : `The sandbox exited (${String(signal ?? code)}).`;
        if (this.child === child) this.child = null;
        if (!ready) reject(new SandboxUnavailableError(reason));
        this.failPending(reason);
        if (!this.stopped) this.options.onExit?.(reason);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        if (!ready) reject(new SandboxUnavailableError(error.message));
      });
      const init: ParentMessage = {
        type: 'init',
        code: this.options.code,
        limits: this.options.limits ?? {},
      };
      child.send(init);
    });
  }

  private answerCall(
    child: ChildProcess,
    id: number,
    callId: number,
    method: string,
    args: readonly unknown[],
  ): void {
    const pending = this.pending.get(id);
    const reply = (message: ParentMessage) => {
      if (child.connected) child.send(message);
    };
    if (!pending) {
      reply({ type: 'callResult', callId, ok: false, error: 'The invocation is over.' });
      return;
    }
    pending.onCall(method, args).then(
      (value) => {
        reply({ type: 'callResult', callId, ok: true, value: value ?? null });
      },
      (error: unknown) => {
        reply({
          type: 'callResult',
          callId,
          ok: false,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        });
      },
    );
  }

  private failPending(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        result: { ok: false, error: { code: 'plugin_error', message } },
        logs: [],
      });
      this.pending.delete(id);
    }
  }

  private kill(child: ChildProcess, reason: string): void {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    this.failPending(reason);
  }

  /**
   * Runs one handler in the sandbox. Invocations of one plugin run one after another. Never throws for plugin
   * failures (see `InvocationResult`); throws `SandboxUnavailableError` when the process cannot start.
   */
  invoke(invocation: Invocation, onCall: HostCallHandler): Promise<InvocationOutcome> {
    const run = async (): Promise<InvocationOutcome> => {
      await this.start();
      const child = this.child;
      if (!child?.connected) throw new SandboxUnavailableError('The sandbox is not running.');
      const id = this.nextId++;
      return new Promise<InvocationOutcome>((resolve) => {
        const timer = setTimeout(
          () => {
            // The child did not answer within its deadline: it is stuck (e.g. in a long native operation).
            this.pending.delete(id);
            resolve({
              result: {
                ok: false,
                error: { code: 'timeout', message: 'The plugin did not finish in time.' },
              },
              logs: [],
            });
            this.kill(child, 'The sandbox was stopped because a call overran its deadline.');
          },
          invocation.timeoutMs + (this.options.graceMs ?? 1_000),
        );
        this.pending.set(id, { resolve, onCall, timer });
        const message: ParentMessage = { type: 'invoke', id, invocation };
        child.send(message);
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Stops the sandbox process for good. */
  stop(): void {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (child) this.kill(child, 'The sandbox was stopped.');
  }
}
