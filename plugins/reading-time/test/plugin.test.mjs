import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadPlugin } from '@nexora/plugin-sdk/testing';

const directory = fileURLToPath(new URL('..', import.meta.url));

test('estimates the reading time from the word count and settings', async () => {
  const plugin = await loadPlugin(directory);
  assert.equal(await plugin.shortcodeText('reading_time', {}, { wordCount: 690 }), '3 min read');
  assert.equal(await plugin.shortcodeText('reading_time', {}, { wordCount: 10 }), '1 min read');
  const slow = await loadPlugin(directory, {
    settings: { wordsPerMinute: 100, label: '{minutes} دقیقه مطالعه' },
  });
  assert.equal(await slow.shortcodeText('reading_time', {}, { wordCount: 690 }), '7 دقیقه مطالعه');
});

test('lets one shortcode override the text, and validates attributes like NEXORA', async () => {
  const plugin = await loadPlugin(directory);
  assert.equal(
    await plugin.shortcodeText(
      'reading_time',
      { label: 'About {minutes} minutes' },
      { wordCount: 460 },
    ),
    'About 2 minutes',
  );
  await assert.rejects(plugin.shortcode('reading_time', { colour: 'red' }), /Invalid attributes/);
});
