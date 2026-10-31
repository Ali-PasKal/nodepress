import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Absolute path of the Prisma CLI entry point. Tests run it with the current Node binary
 * (`execFile(process.execPath, [PRISMA_CLI, ...])`) so no shell or `.cmd` shim is involved, which
 * keeps the suite working on Windows as well as macOS/Linux.
 */
export const PRISMA_CLI = join(
  dirname(require.resolve('prisma/package.json')),
  'build',
  'index.js',
);
