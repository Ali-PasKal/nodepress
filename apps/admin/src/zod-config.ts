import { z } from 'zod';

/**
 * Must be the first import of the app entry point, before any schema is constructed.
 *
 * Zod 4 JIT-compiles object parsers with `new Function` when it detects that eval is allowed. Merely
 * probing for that capability triggers a CSP `script-src` violation under the admin's policy, which
 * deliberately excludes 'unsafe-eval'. Jitless mode uses Zod's interpreter path only.
 */
z.config({ jitless: true });
