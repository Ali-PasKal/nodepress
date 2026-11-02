import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadPlugin } from '@nexora/plugin-sdk/testing';

const directory = fileURLToPath(new URL('..', import.meta.url));
const post = (id, title, terms) => ({
  id,
  type: 'post',
  title,
  url: `/blog/${id}`,
  excerpt: '',
  publishedAt: '2026-11-01T10:00:00.000Z',
  terms: terms.map((slug) => ({ taxonomy: 'category', slug, name: slug })),
});
const content = [
  post('a', 'Alpha', ['news']),
  post('b', 'Beta', ['news', 'tips']),
  post('c', 'Gamma', ['tips']),
  post('d', 'Delta', ['other']),
];
const current = {
  id: 'a',
  type: 'post',
  terms: [{ taxonomy: 'category', slug: 'news', name: 'News' }],
};

test('lists entries sharing a term, without the current one', async () => {
  const plugin = await loadPlugin(directory, { content });
  const document = await plugin.shortcode('related_posts', {}, current);
  assert.equal(document?.content[0]?.type, 'heading');
  assert.equal(
    await plugin.shortcodeText('related_posts', { title: 'More' }, current),
    'More Beta',
  );
  const links = JSON.stringify(document);
  assert.match(links, /"href":"\/blog\/b"/);
  assert.doesNotMatch(links, /\/blog\/a"|\/blog\/d"/);
});

test('shows nothing without terms or matches, and respects count', async () => {
  const plugin = await loadPlugin(directory, { content });
  assert.equal(await plugin.shortcode('related_posts', {}, { ...current, terms: [] }), null);
  assert.equal(
    await plugin.shortcode(
      'related_posts',
      {},
      { ...current, terms: [{ taxonomy: 'tag', slug: 'none', name: 'x' }] },
    ),
    null,
  );
  const tips = {
    id: 'z',
    type: 'post',
    terms: [{ taxonomy: 'category', slug: 'tips', name: 'Tips' }],
  };
  assert.equal(
    await plugin.shortcodeText('related_posts', { count: '1' }, tips),
    'Related posts Beta',
  );
});
