// Runs in the NEXORA plugin sandbox: plain JavaScript, no Node.js APIs; everything comes through `ctx`.
// Requests go through NEXORA, which only allows the hosts in the manifest (and refuses private addresses).

const HOSTS = { slack: 'hooks.slack.com', discord: 'discord.com' };

/** @type {import('@nexora/plugin-sdk').PluginDefinition<{ service: 'slack' | 'discord'; webhookUrl: string | null; message: string }>} */
export default {
  hooks: {
    async 'entry.published'(event, ctx) {
      const { service, webhookUrl, message } = ctx.settings;
      if (!webhookUrl) {
        ctx.log.warn('No webhook URL is set; nothing was sent.');
        return;
      }
      const host = /^https:\/\/([^/?#]+)\//.exec(webhookUrl)?.[1];
      if (host !== HOSTS[service]) {
        ctx.log.error(`The webhook URL must start with https://${HOSTS[service]}/ for ${service}.`);
        return;
      }
      const text = message
        .replaceAll('{title}', event.entry.title)
        .replaceAll('{url}', event.entry.url ?? '');
      const response = await ctx.http.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(service === 'discord' ? { content: text } : { text }),
      });
      // Failures are retried by NEXORA's job queue.
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`The webhook answered ${response.status}.`);
      }
      ctx.log.info(`Sent to ${service}: ${event.entry.title}`);
    },
  },
};
