// Recreates the public schema of the end-to-end test database so every E2E run starts from a fresh,
// not-yet-installed instance. Refuses to touch any database whose name does not end in "_e2e".
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const name = new URL(url).pathname.replace(/^\//, '');
if (!name.endsWith('_e2e')) {
  console.error(
    `Refusing to reset "${name}": only databases whose name ends in "_e2e" can be reset.`,
  );
  process.exit(1);
}

// Connect to the maintenance database first so the E2E database can be created if it is missing.
const admin = new pg.Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
await admin.connect();
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (exists.rowCount === 0) {
  await admin.query(`CREATE DATABASE "${name.replaceAll('"', '')}"`);
}
await admin.end();

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE');
await client.query('CREATE SCHEMA public');
await client.end();
console.warn(`Reset end-to-end database "${name}".`);
