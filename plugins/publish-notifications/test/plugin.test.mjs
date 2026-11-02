import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadPlugin } from '@nexora/plugin-sdk/testing';

const directory = fileURLToPath(new URL('..', import.meta.url));
const ok = () => ({ status: 200, headers: {}, body: 'ok' });

test('posts the message to Slack', async () => {
  const plugin = await loadPlugin(directory, {
    settings: { webhookUrl: 'https://hooks.slack.com/services/T0/B0/xyz' },
    fetch: ok,
  });
  await plugin.hook('entry.published', { title: 'Hello', url: 'https://example.com/blog/hello' });
  assert.equal(plugin.requests.length, 1);
  assert.equal(plugin.requests[0].url, 'https://hooks.slack.com/services/T0/B0/xyz');
  assert.equal(plugin.requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(plugin.requests[0].init.body), {
    text: 'New on the site: Hello https://example.com/blog/hello',
  });
});

test('uses the Discord format and a custom message', async () => {
  const plugin = await loadPlugin(directory, {
    settings: {
      service: 'discord',
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
      message: '📢 {title}',
    },
    fetch: ok,
  });
  await plugin.hook('entry.published', { title: 'Release' });
  assert.deepEqual(JSON.parse(plugin.requests[0].init.body), { content: '📢 Release' });
});

test('sends nothing without a matching webhook, and fails (to be retried) on errors', async () => {
  const missing = await loadPlugin(directory, { fetch: ok });
  await missing.hook('entry.published');
  assert.equal(missing.requests.length, 0);
  assert.match(missing.logs[0].message, /No webhook URL/);

  const wrong = await loadPlugin(directory, {
    settings: { webhookUrl: 'https://evil.example/hook' },
    fetch: ok,
  });
  await wrong.hook('entry.published');
  assert.equal(wrong.requests.length, 0);

  const failing = await loadPlugin(directory, {
    settings: { webhookUrl: 'https://hooks.slack.com/services/x' },
    fetch: () => ({ status: 500, headers: {}, body: '' }),
  });
  await assert.rejects(failing.hook('entry.published'), /answered 500/);
});
