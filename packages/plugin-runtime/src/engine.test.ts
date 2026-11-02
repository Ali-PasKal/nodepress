import { beforeAll, describe, expect, it } from 'vitest';
import { PluginEngine, type HostCallHandler, type Invocation } from './engine.js';

let engine: PluginEngine;
beforeAll(async () => {
  engine = await PluginEngine.create({ memoryBytes: 32 * 1024 * 1024 });
});

const noCalls: HostCallHandler = () => Promise.reject(new Error('no host calls expected'));

function shortcode(name: string, attrs: object = {}, timeoutMs = 1_000): Invocation {
  return {
    kind: 'shortcode',
    name,
    input: { attrs, entry: { id: 'e1', title: 'Hello' } },
    settings: { greeting: 'Hi' },
    timeoutMs,
  };
}

const plugin = (body: string) =>
  `export default { shortcodes: { async run(attrs, ctx) { ${body} } } };`;

describe('plugin engine', () => {
  it('runs handlers with attributes, settings and the entry, and lists what the plugin offers', async () => {
    const code = `
      export default {
        shortcodes: { greet(attrs, ctx) { return ctx.settings.greeting + ' ' + attrs.name + ' on ' + ctx.entry.title; } },
        hooks: { 'entry.published': async () => {} },
      };`;
    const described = await engine.invoke(
      code,
      { kind: 'describe', name: '', input: null, settings: {}, timeoutMs: 1_000 },
      noCalls,
    );
    expect(described.result).toEqual({
      ok: true,
      value: { shortcodes: ['greet'], hooks: ['entry.published'] },
    });
    const greeted = await engine.invoke(code, shortcode('greet', { name: 'Ada' }), noCalls);
    expect(greeted.result).toEqual({ ok: true, value: 'Hi Ada on Hello' });
  });

  it('exposes no host environment to plugin code', async () => {
    const code = plugin(`
      return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof WebAssembly,
        typeof globalThis.__host_call, typeof globalThis.__host_log, typeof XMLHttpRequest].join(',');`);
    const { result } = await engine.invoke(code, shortcode('run'), noCalls);
    expect(result).toEqual({
      ok: true,
      value: 'undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined',
    });
    const imports = await engine.invoke(
      `import fs from 'fs'; export default { shortcodes: { run() { return 1; } } };`,
      shortcode('run'),
      noCalls,
    );
    expect(imports.result.ok).toBe(false);
  });

  it('keeps nothing between calls', async () => {
    const code = `globalThis.counter = (globalThis.counter || 0) + 1;
      export default { shortcodes: { run() { return globalThis.counter; } } };`;
    for (let index = 0; index < 3; index += 1) {
      const { result } = await engine.invoke(code, shortcode('run'), noCalls);
      expect(result).toEqual({ ok: true, value: 1 });
    }
  });

  it('stops infinite loops, deep recursion and memory exhaustion, and stays usable', async () => {
    const loop = await engine.invoke(plugin('for (;;) {}'), shortcode('run', {}, 200), noCalls);
    expect(loop.result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    const recursion = await engine.invoke(
      plugin('const f = () => f(); return f();'),
      shortcode('run'),
      noCalls,
    );
    expect(recursion.result).toMatchObject({ ok: false, error: { code: 'limit' } });
    const memory = await engine.invoke(
      plugin('const a = []; for (let i = 0; ; i++) a.push(new Array(1e5).fill(i));'),
      shortcode('run', {}, 10_000),
      noCalls,
    );
    expect(memory.result).toMatchObject({ ok: false, error: { code: 'out_of_memory' } });
    const strings = await engine.invoke(
      plugin('let s = "x"; for (;;) s += s;'),
      shortcode('run', {}, 10_000),
      noCalls,
    );
    expect(strings.result.ok).toBe(false);
    const after = await engine.invoke(plugin('return "still fine";'), shortcode('run'), noCalls);
    expect(after.result).toEqual({ ok: true, value: 'still fine' });
  });

  it('times out while waiting for the host', async () => {
    const slow: HostCallHandler = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('late');
        }, 2_000);
      });
    const { result } = await engine.invoke(
      plugin('return await ctx.storage.get("a");'),
      shortcode('run', {}, 150),
      slow,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    const after = await engine.invoke(plugin('return 2;'), shortcode('run'), noCalls);
    expect(after.result).toEqual({ ok: true, value: 2 });
  });

  it('bridges host calls with JSON values and errors, and limits them', async () => {
    const seen: [string, readonly unknown[]][] = [];
    const host: HostCallHandler = (method, args) => {
      seen.push([method, args]);
      if (method === 'http.fetch')
        return Promise.reject(new Error('Permission denied: http:fetch'));
      return Promise.resolve({ value: 42, list: [1, 'two'] });
    };
    const { result } = await engine.invoke(
      plugin(`
        const stored = await ctx.storage.get('counter');
        await ctx.storage.set('counter', { n: 1 });
        let denied = '';
        try { await ctx.http.fetch('https://example.com', { method: 'POST' }); } catch (e) { denied = e.message; }
        return { stored, denied };`),
      shortcode('run'),
      host,
    );
    expect(result).toEqual({
      ok: true,
      value: { stored: { value: 42, list: [1, 'two'] }, denied: 'Permission denied: http:fetch' },
    });
    expect(seen).toEqual([
      ['storage.get', ['counter']],
      ['storage.set', ['counter', { n: 1 }]],
      ['http.fetch', ['https://example.com', { method: 'POST' }]],
    ]);
    const many = await engine.invoke(
      plugin('for (let i = 0; i < 60; i++) await ctx.storage.get("k" + i); return "done";'),
      shortcode('run'),
      () => Promise.resolve(null),
    );
    expect(many.result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Too many calls') as unknown },
    });
  });

  it('collects bounded logs and refuses oversized results', async () => {
    const logged = await engine.invoke(
      plugin(
        'for (let i = 0; i < 30; i++) console.log("line", i, { i }); ctx.log.error("x".repeat(5000)); return 1;',
      ),
      shortcode('run'),
      noCalls,
    );
    expect(logged.logs).toHaveLength(20);
    expect(logged.logs[0]).toEqual({ level: 'info', message: 'line 0 {"i":0}' });
    const big = await engine.invoke(
      plugin('return "x".repeat(300000);'),
      shortcode('run'),
      noCalls,
    );
    expect(big.result).toMatchObject({ ok: false, error: { code: 'invalid_result' } });
  });

  it('reports plugin errors without throwing', async () => {
    const thrown = await engine.invoke(
      plugin('throw new Error("boom");'),
      shortcode('run'),
      noCalls,
    );
    expect(thrown.result).toEqual({
      ok: false,
      error: { code: 'plugin_error', message: 'Error: boom' },
    });
    const syntax = await engine.invoke('export default {', shortcode('run'), noCalls);
    expect(syntax.result).toMatchObject({ ok: false, error: { code: 'plugin_error' } });
    const missing = await engine.invoke(plugin('return 1;'), shortcode('other'), noCalls);
    expect(missing.result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('no shortcode handler named "other"') as unknown },
    });
    const noDefault = await engine.invoke('export const x = 1;', shortcode('run'), noCalls);
    expect(noDefault.result).toMatchObject({ ok: false, error: { code: 'plugin_error' } });
  });
});
