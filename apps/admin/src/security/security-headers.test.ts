// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMIN_CONTENT_SECURITY_POLICY, ADMIN_SECURITY_HEADERS } from '../../security-headers';

const nginxSnippet = readFileSync(
  fileURLToPath(
    new URL('../../../../infrastructure/docker/admin/security-headers.conf', import.meta.url),
  ),
  'utf8',
);

describe('admin security headers', () => {
  it('never allows inline or eval-based scripts', () => {
    const scriptSrc = ADMIN_CONTENT_SECURITY_POLICY.split('; ').find((directive) =>
      directive.startsWith('script-src'),
    );
    expect(scriptSrc).toBe("script-src 'self'");
    expect(ADMIN_CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-eval/);
    expect(ADMIN_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(ADMIN_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it.each(Object.entries(ADMIN_SECURITY_HEADERS))(
    'nginx sends %s exactly as defined',
    (name, value) => {
      expect(nginxSnippet).toContain(`add_header ${name} "${value}" always;`);
    },
  );
});
