import { pino } from 'pino';
import { createSiteApp } from './app.js';
import { loadConfig } from './config.js';
import { createDeliveryClient } from './delivery-client.js';
import { ThemeSet } from './themes.js';

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  base: { service: 'nexora-site' },
});

const themes = await ThemeSet.load();
const app = createSiteApp({
  client: createDeliveryClient(config.deliveryApiUrl, config.apiTimeoutMs),
  themes,
  logger,
});

const server = app.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, deliveryApi: config.deliveryApiUrl },
    'NEXORA site runtime listening',
  );
});
server.keepAliveTimeout = 65_000;
server.requestTimeout = 30_000;

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
