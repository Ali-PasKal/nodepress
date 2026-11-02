// Runs in the NEXORA plugin sandbox: plain JavaScript, no Node.js APIs; everything comes through `ctx`.

/** @type {import('@nexora/plugin-sdk').PluginDefinition} */
export default {
  shortcodes: {
    async related_posts(attrs, ctx) {
      const terms = ctx.entry.terms.map((term) => `${term.taxonomy}:${term.slug}`);
      if (terms.length === 0) return null;
      const items = await ctx.content.list({
        type: ctx.entry.type,
        terms,
        exclude: [ctx.entry.id],
        limit: attrs.count,
      });
      if (items.length === 0) return null;
      return {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: attrs.title }] },
          {
            type: 'bulletList',
            content: items.map((item) => ({
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: item.title,
                      marks: [{ type: 'link', attrs: { href: item.url } }],
                    },
                  ],
                },
              ],
            })),
          },
        ],
      };
    },
  },
};
