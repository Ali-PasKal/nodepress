// Runs in the NEXORA plugin sandbox: plain JavaScript, no Node.js APIs; everything comes through `ctx`.

/** @type {import('@nexora/plugin-sdk').PluginDefinition<{ wordsPerMinute: number; label: string }>} */
export default {
  shortcodes: {
    reading_time(attrs, ctx) {
      const minutes = Math.max(1, Math.round(ctx.entry.wordCount / ctx.settings.wordsPerMinute));
      const template =
        typeof attrs.label === 'string' && attrs.label !== '' ? attrs.label : ctx.settings.label;
      return template.replaceAll('{minutes}', String(minutes));
    },
  },
};
