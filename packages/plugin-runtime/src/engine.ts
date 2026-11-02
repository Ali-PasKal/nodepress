import releaseVariant from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSSyncVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';

/**
 * Runs plugin code in QuickJS compiled to WebAssembly.
 *
 * Plugin code sees a bare JavaScript environment: no Node.js APIs, no timers, no network, no filesystem — only
 * the context object built by the bootstrap below, whose methods call back into the host. Every call gets a
 * fresh runtime and context, so nothing survives between calls. Limits: a wall-clock deadline (checked by the
 * engine's interrupt handler and by the host), a stack limit, and a hard cap on the WebAssembly memory (the
 * engine's own memory accounting is not reliable in this build, the memory cap is).
 *
 * This module must only import the engine packages: it is loaded by the sandbox process, which may read nothing
 * else.
 */

export interface EngineLimits {
  /** Maximum size of the engine's WebAssembly memory (all plugin data lives there). */
  readonly memoryBytes: number;
  readonly stackBytes: number;
  /** Host calls (storage, content, http) per invocation. */
  readonly maxHostCalls: number;
  /** Size of the JSON a handler may return. */
  readonly maxResultBytes: number;
  /** Size of the JSON arguments of one host call. */
  readonly maxCallArgumentBytes: number;
  readonly maxLogLines: number;
  readonly maxLogLength: number;
}

export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 256 * 1024,
  maxHostCalls: 50,
  maxResultBytes: 256 * 1024,
  maxCallArgumentBytes: 64 * 1024,
  maxLogLines: 20,
  maxLogLength: 1_000,
};

export type InvocationKind = 'describe' | 'shortcode' | 'hook';

export interface Invocation {
  readonly kind: InvocationKind;
  /** Shortcode or hook name (empty for `describe`). */
  readonly name: string;
  /** JSON input: `{ attrs, entry }` for shortcodes, the event for hooks. */
  readonly input: unknown;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
}

export type InvocationErrorCode =
  'timeout' | 'out_of_memory' | 'limit' | 'plugin_error' | 'invalid_result';

export type InvocationResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: { readonly code: InvocationErrorCode; readonly message: string };
    };

export interface LogLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

/** Handles a host call from the plugin (`storage.get`, `content.list`, `http.fetch`, …). */
export type HostCallHandler = (method: string, args: readonly unknown[]) => Promise<unknown>;

/** Thrown when the engine could not be cleaned up; the process should exit and be restarted. */
export class EngineCorruptedError extends Error {
  override readonly name = 'EngineCorruptedError';
}

const WASM_PAGE = 64 * 1024;

// The variant package ships CommonJS typings; at runtime the ES module's default export is the variant.
const imported = releaseVariant as unknown as QuickJSSyncVariant & { default?: QuickJSSyncVariant };
const variant: QuickJSSyncVariant = imported.default ?? imported;

// Node's typings here do not declare the WebAssembly global.
declare const WebAssembly: {
  Memory: new (descriptor: { initial: number; maximum: number }) => object;
};

/** Trusted code evaluated before the plugin in each context; it builds the plugin's `ctx` object. */
const BOOTSTRAP = String.raw`
(() => {
  'use strict';
  const call = globalThis.__host_call;
  const writeLog = globalThis.__host_log;
  delete globalThis.__host_call;
  delete globalThis.__host_log;
  const send = (method, args) => call(method, JSON.stringify(args)).then((text) => JSON.parse(text));
  const format = (values) =>
    values
      .map((value) => {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return String(value); }
      })
      .join(' ');
  const logger = (level) => (...values) => { writeLog(level, format(values)); };
  const log = Object.freeze({ info: logger('info'), warn: logger('warn'), error: logger('error') });
  globalThis.console = Object.freeze({
    log: log.info, info: log.info, debug: log.info, warn: log.warn, error: log.error,
  });
  const makeContext = (settings, entry) =>
    Object.freeze({
      settings: Object.freeze(settings),
      entry: entry === undefined ? undefined : Object.freeze(entry),
      log,
      storage: Object.freeze({
        get: (key) => send('storage.get', [key]),
        set: (key, value) => send('storage.set', [key, value === undefined ? null : value]),
        delete: (key) => send('storage.delete', [key]),
      }),
      content: Object.freeze({
        list: (query) => send('content.list', [query === undefined ? {} : query]),
        get: (id) => send('content.get', [id]),
      }),
      http: Object.freeze({
        fetch: (url, init) => send('http.fetch', [url, init === undefined ? {} : init]),
      }),
    });
  const own = (table, name) =>
    table !== null && typeof table === 'object' && Object.prototype.hasOwnProperty.call(table, name)
      ? table[name]
      : undefined;
  Object.defineProperty(globalThis, '__nexora_run', {
    value: async (namespace, kind, name, inputJson, settingsJson) => {
      const plugin = namespace.default;
      if (plugin === null || typeof plugin !== 'object') {
        throw new TypeError('The plugin must export an object as its default export.');
      }
      const names = (table) =>
        table !== null && typeof table === 'object'
          ? Object.keys(table).filter((key) => typeof table[key] === 'function')
          : [];
      if (kind === 'describe') {
        return JSON.stringify({ shortcodes: names(plugin.shortcodes), hooks: names(plugin.hooks) });
      }
      const input = JSON.parse(inputJson);
      const settings = JSON.parse(settingsJson);
      const handler = own(kind === 'shortcode' ? plugin.shortcodes : plugin.hooks, name);
      if (typeof handler !== 'function') {
        throw new TypeError('The plugin has no ' + kind + ' handler named "' + name + '".');
      }
      const result =
        kind === 'shortcode'
          ? await handler(input.attrs, makeContext(settings, input.entry))
          : await handler(input, makeContext(settings, undefined));
      const json = JSON.stringify(result === undefined ? null : result);
      return json === undefined ? 'null' : json;
    },
  });
})();
`;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function classify(dumped: unknown): { code: InvocationErrorCode; message: string } {
  const record =
    dumped !== null && typeof dumped === 'object' ? (dumped as Record<string, unknown>) : {};
  const name = typeof record.name === 'string' ? record.name : 'Error';
  const message = typeof record.message === 'string' ? record.message : String(dumped);
  if (name === 'InternalError' && message === 'interrupted') {
    return { code: 'timeout', message: 'The plugin did not finish in time.' };
  }
  if (name === 'InternalError' && message === 'out of memory') {
    return { code: 'out_of_memory', message: 'The plugin ran out of memory.' };
  }
  if (name === 'InternalError' && message === 'stack overflow') {
    return { code: 'limit', message: 'The plugin exceeded the stack limit.' };
  }
  return { code: 'plugin_error', message: `${name}: ${message}`.slice(0, 500) };
}

export class PluginEngine {
  private constructor(
    private readonly module: QuickJSWASMModule,
    readonly limits: EngineLimits,
  ) {}

  static async create(limits: Partial<EngineLimits> = {}): Promise<PluginEngine> {
    const resolved = { ...DEFAULT_ENGINE_LIMITS, ...limits };
    const memory = new WebAssembly.Memory({
      initial: 256,
      maximum: Math.max(256, Math.floor(resolved.memoryBytes / WASM_PAGE)),
    });
    const module = await newQuickJSWASMModuleFromVariant(
      newVariant(variant, { wasmMemory: memory as never }),
    );
    return new PluginEngine(module, resolved);
  }

  /** Runs one handler of the plugin. Never throws for plugin failures; see `InvocationResult`. */
  async invoke(
    code: string,
    invocation: Invocation,
    onCall: HostCallHandler,
  ): Promise<{ result: InvocationResult; logs: LogLine[] }> {
    const limits = this.limits;
    const logs: LogLine[] = [];
    const deadline = Date.now() + invocation.timeoutMs;
    const pending = new Set<QuickJSDeferredPromise>();
    let finished = false;
    let calls = 0;
    let runtime: QuickJSRuntime | null = null;
    let context: QuickJSContext | null = null;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: InvocationResult) => ({ result, logs });
    try {
      runtime = this.module.newRuntime();
      runtime.setMaxStackSize(limits.stackBytes);
      runtime.setMemoryLimit(limits.memoryBytes);
      runtime.setInterruptHandler(() => Date.now() > deadline);
      const rt = runtime;
      const vm = runtime.newContext();
      context = vm;

      const settle = (deferred: QuickJSDeferredPromise, apply: () => void) => {
        pending.delete(deferred);
        if (finished || !deferred.alive) return;
        apply();
        rt.executePendingJobs();
      };

      const hostCall = vm.newFunction('__host_call', (methodHandle, argsHandle) => {
        const method = vm.getString(methodHandle);
        const argsJson = vm.getString(argsHandle);
        const deferred = vm.newPromise();
        pending.add(deferred);
        calls += 1;
        const reject = (message: string) => {
          settle(deferred, () => {
            const error = vm.newError(message);
            deferred.reject(error);
            error.dispose();
          });
        };
        if (calls > limits.maxHostCalls) {
          queueMicrotask(() => {
            reject('Too many calls in one invocation.');
          });
        } else if (argsJson.length > limits.maxCallArgumentBytes) {
          queueMicrotask(() => {
            reject('The arguments are too large.');
          });
        } else {
          let args: unknown[];
          try {
            const parsed: unknown = JSON.parse(argsJson);
            args = Array.isArray(parsed) ? parsed : [];
          } catch {
            args = [];
          }
          onCall(method, args).then(
            (value) => {
              settle(deferred, () => {
                const text = vm.newString(JSON.stringify(value ?? null));
                deferred.resolve(text);
                text.dispose();
              });
            },
            (error: unknown) => {
              reject(errorMessage(error).slice(0, 500));
            },
          );
        }
        return deferred.handle;
      });
      vm.setProp(vm.global, '__host_call', hostCall);
      hostCall.dispose();

      const hostLog = vm.newFunction('__host_log', (levelHandle, messageHandle) => {
        if (logs.length >= limits.maxLogLines) return;
        const level = vm.getString(levelHandle);
        logs.push({
          level: level === 'warn' || level === 'error' ? level : 'info',
          message: vm.getString(messageHandle).slice(0, limits.maxLogLength),
        });
      });
      vm.setProp(vm.global, '__host_log', hostLog);
      hostLog.dispose();

      const boot = vm.evalCode(BOOTSTRAP, 'bootstrap.js');
      vm.unwrapResult(boot).dispose();

      const loaded = vm.evalCode(code, 'plugin.js', { type: 'module' });
      if (loaded.error) {
        const error = classify(vm.dump(loaded.error));
        loaded.error.dispose();
        return finish({ ok: false, error });
      }
      const namespace = loaded.value;
      const run = vm.getProp(vm.global, '__nexora_run');
      const args: QuickJSHandle[] = [
        namespace,
        vm.newString(invocation.kind),
        vm.newString(invocation.name),
        vm.newString(JSON.stringify(invocation.input ?? null)),
        vm.newString(JSON.stringify(invocation.settings)),
      ];
      const called = vm.callFunction(run, vm.undefined, ...args);
      for (const handle of args) handle.dispose();
      run.dispose();
      if (called.error) {
        const error = classify(vm.dump(called.error));
        called.error.dispose();
        return finish({ ok: false, error });
      }
      const promise = called.value;
      const settled = vm.resolvePromise(promise);
      promise.dispose();
      rt.executePendingJobs();

      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(
          () => {
            resolve('timeout');
          },
          Math.max(0, deadline - Date.now()),
        );
      });
      const outcome = await Promise.race([settled, timeout]);
      if (outcome === 'timeout') {
        return finish({
          ok: false,
          error: { code: 'timeout', message: 'The plugin did not finish in time.' },
        });
      }
      if (outcome.error) {
        const error = classify(vm.dump(outcome.error));
        outcome.error.dispose();
        return finish({ ok: false, error });
      }
      const json = vm.getString(outcome.value);
      outcome.value.dispose();
      if (json.length > limits.maxResultBytes) {
        return finish({
          ok: false,
          error: { code: 'invalid_result', message: 'The plugin returned too much data.' },
        });
      }
      return finish({ ok: true, value: JSON.parse(json) as unknown });
    } catch (error) {
      if (error instanceof EngineCorruptedError) throw error;
      return finish({ ok: false, error: { code: 'plugin_error', message: errorMessage(error) } });
    } finally {
      finished = true;
      clearTimeout(timer);
      try {
        for (const deferred of pending) if (deferred.alive) deferred.dispose();
        pending.clear();
        context?.dispose();
        runtime?.dispose();
      } catch (error) {
        // eslint-disable-next-line no-unsafe-finally -- a broken engine must not be reused
        throw new EngineCorruptedError(
          `The engine could not be cleaned up: ${errorMessage(error)}`,
        );
      }
    }
  }
}
