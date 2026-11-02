import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Invocation } from './engine.js';
import { PluginProcess, sandboxExecArgv } from './process.js';

// Tests run against the compiled sandbox entry (`pnpm test` builds first).
const hostPath = fileURLToPath(new URL('../dist/host.js', import.meta.url));
const probePath = fileURLToPath(new URL('../test-fixtures/probe.mjs', import.meta.url));

const processes: PluginProcess[] = [];
afterEach(() => {
  for (const process of processes.splice(0)) process.stop();
});

function sandbox(code: string, exits: string[] = []): PluginProcess {
  const created = new PluginProcess({
    code,
    hostPath,
    graceMs: 500,
    onExit: (reason) => exits.push(reason),
  });
  processes.push(created);
  return created;
}

const call = (name: string, timeoutMs = 1_000): Invocation => ({
  kind: 'shortcode',
  name,
  input: { attrs: {}, entry: null },
  settings: {},
  timeoutMs,
});

describe('sandbox process', () => {
  it('confines the process: empty environment, no reads outside its packages, no processes, no writes', async () => {
    const child = fork(probePath, [], {
      env: {},
      execArgv: sandboxExecArgv(hostPath, 64),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const results = await new Promise<Record<string, unknown>>((resolve, reject) => {
      child.once('message', (message) => {
        resolve(message as Record<string, unknown>);
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        reject(new Error(`probe exited with ${String(code)}`));
      });
    });
    expect(results.env).toEqual([]);
    expect(results.readEtc).toBe('ERR_ACCESS_DENIED');
    expect(results.readRepo).toBe('ERR_ACCESS_DENIED');
    expect(results.readOwn).toBe('allowed');
    expect(results.spawn).toBe('ERR_ACCESS_DENIED');
    expect(results.writeTmp).toBe('ERR_ACCESS_DENIED');
    expect(results.evalString).toBe('EvalError');
  });

  it('runs plugin calls in the child and answers host calls through the parent', async () => {
    const plugin = sandbox(`export default { shortcodes: {
      async hello(attrs, ctx) { const n = await ctx.storage.get('n'); console.log('n is', n); return 'n=' + n; },
    } };`);
    const seen: string[] = [];
    const outcome = await plugin.invoke(call('hello'), (method, args) => {
      seen.push(`${method}:${JSON.stringify(args)}`);
      return Promise.resolve(7);
    });
    expect(outcome.result).toEqual({ ok: true, value: 'n=7' });
    expect(outcome.logs).toEqual([{ level: 'info', message: 'n is 7' }]);
    expect(seen).toEqual(['storage.get:["n"]']);
    expect(plugin.pid).toBeGreaterThan(0);
  });

  it('runs invocations one after another and reports refused host calls to the plugin', async () => {
    const plugin = sandbox(`export default { shortcodes: {
      async n(attrs, ctx) { try { await ctx.http.fetch('https://example.com'); return 'fetched'; } catch (e) { return e.message; } },
    } };`);
    const outcomes = await Promise.all(
      [1, 2, 3].map(() =>
        plugin.invoke(call('n'), () => Promise.reject(new Error('Permission denied: http:fetch'))),
      ),
    );
    for (const outcome of outcomes) {
      expect(outcome.result).toEqual({ ok: true, value: 'Permission denied: http:fetch' });
    }
  });

  it('lets the engine stop a call at its deadline without restarting the process', async () => {
    const plugin = sandbox(`export default { shortcodes: {
      slow() { const a = []; for (let i = 0; i < 1e9; i++) a.push(i % 10); return a.length; },
      quick() { return 'ok'; },
    } };`);
    const outcome = await plugin.invoke(call('slow', 300), () => Promise.resolve(null));
    expect(outcome.result).toMatchObject({ ok: false });
    const pid = plugin.pid;
    const next = await plugin.invoke(call('quick'), () => Promise.resolve(null));
    expect(next.result).toEqual({ ok: true, value: 'ok' });
    expect(plugin.pid).toBe(pid);
  });

  it('kills a child that does not answer by the deadline and starts a fresh one', async () => {
    // A negative grace makes the parent's watchdog fire before the engine's own deadline, standing in for
    // an operation the engine cannot interrupt.
    const exits: string[] = [];
    const plugin = new PluginProcess({
      code: `export default { shortcodes: {
        spin() { for (;;) {} },
        quick() { return 'ok'; },
      } };`,
      hostPath,
      graceMs: -900,
      onExit: (reason) => exits.push(reason),
    });
    processes.push(plugin);
    await plugin.start();
    const firstPid = plugin.pid;
    const outcome = await plugin.invoke(call('spin', 1_000), () => Promise.resolve(null));
    expect(outcome.result).toEqual({
      ok: false,
      error: { code: 'timeout', message: 'The plugin did not finish in time.' },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exits.join()).toMatch(/SIGKILL/);
    const next = await plugin.invoke(call('quick', 5_000), () => Promise.resolve(null));
    expect(next.result).toEqual({ ok: true, value: 'ok' });
    expect(plugin.pid).not.toBe(firstPid);
  });

  it('reports a child that dies and restarts on the next call', async () => {
    const exits: string[] = [];
    const plugin = sandbox(`export default { shortcodes: { ok() { return 1; } } };`, exits);
    await plugin.invoke(call('ok'), () => Promise.resolve(null));
    process.kill(plugin.pid ?? 0, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatch(/exited/);
    const again = await plugin.invoke(call('ok'), () => Promise.resolve(null));
    expect(again.result).toEqual({ ok: true, value: 1 });
  });

  it('refuses to work after stop', async () => {
    const plugin = sandbox(`export default { shortcodes: { ok() { return 1; } } };`);
    plugin.stop();
    await expect(plugin.invoke(call('ok'), () => Promise.resolve(null))).rejects.toThrow(/stopped/);
  });
});
