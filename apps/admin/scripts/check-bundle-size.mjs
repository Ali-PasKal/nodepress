// Performance budget for the admin's initial download: the JavaScript and CSS referenced by
// dist/index.html (entry + modulepreloads), measured gzipped. Lazy route chunks are excluded.
// Run after `pnpm run build`; fails (exit 1) when the budget is exceeded.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = { js: 215, css: 12 };
const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/\/admin\/(assets\/[^"]+\.(js|css))"/g)].map((match) => ({
  file: match[1],
  type: match[2],
}));

const totals = { js: 0, css: 0 };
for (const { file, type } of assets) {
  totals[type] += gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
}
let failed = false;
for (const type of ['js', 'css']) {
  const kb = totals[type] / 1024;
  const ok = kb <= BUDGET_KB[type];
  failed ||= !ok;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} initial ${type.toUpperCase()}: ${kb.toFixed(1)} kB gzip (budget ${String(BUDGET_KB[type])} kB)`,
  );
}
process.exit(failed ? 1 : 0);
