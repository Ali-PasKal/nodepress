import { apiErrorResponseSchema } from '@nexora/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('HTTP security baseline', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await createTestApp({
      REQUEST_BODY_LIMIT: '1kb',
      CORS_ALLOWED_ORIGINS: 'https://admin.example.com',
    });
  });
  afterAll(() => testApp.close());

  it('sends strict security headers on API responses', async () => {
    const response = await request(testApp.server).get('/api/v1/health/live').expect(200);
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns the error envelope for unknown routes without reflecting the path', async () => {
    const response = await request(testApp.server)
      .get('/api/v1/%3Cscript%3Ealert(1)%3C%2Fscript%3E')
      .expect(404);
    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
    expect(response.text).not.toMatch(/script|alert|stack/i);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
  });

  it('rejects request bodies above REQUEST_BODY_LIMIT with 413', async () => {
    const response = await request(testApp.server)
      .post('/api/v1/health/live')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(2048) }))
      .expect(413);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.error.requestId).toMatch(UUID);
  });

  it('rejects malformed JSON with 400 and no parser internals', async () => {
    const response = await request(testApp.server)
      .post('/api/v1/health/live')
      .set('Content-Type', 'application/json')
      .send('{"unterminated":')
      .expect(400);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('BAD_REQUEST');
    expect(response.text).not.toMatch(/Unexpected|JSON\.parse|position/);
  });

  describe('CORS', () => {
    it('allows explicitly listed origins with credentials', async () => {
      const response = await request(testApp.server)
        .get('/api/v1/health/live')
        .set('Origin', 'https://admin.example.com')
        .expect(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://admin.example.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-expose-headers']).toBe('X-Request-Id');
    });

    it('does not grant access to other origins', async () => {
      const response = await request(testApp.server)
        .get('/api/v1/health/live')
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('answers preflight requests only for allowed origins', async () => {
      const allowed = await request(testApp.server)
        .options('/api/v1/system/status')
        .set('Origin', 'https://admin.example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
      expect(allowed.status).toBe(204);
      expect(allowed.headers['access-control-allow-headers']).toBe(
        'Content-Type,X-CSRF-Token,X-Request-Id',
      );

      const denied = await request(testApp.server)
        .options('/api/v1/system/status')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('defaults to same-origin only when no CORS origins are configured', async () => {
    const sameOrigin = await createTestApp();
    try {
      const response = await request(sameOrigin.server)
        .get('/api/v1/health/live')
        .set('Origin', 'http://localhost:5173')
        .expect(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await sameOrigin.close();
    }
  });
});

describe('request ids', () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((testApp) => testApp.close()));
  });

  it('generates a fresh id and ignores inbound ids by default', async () => {
    const testApp = await createTestApp();
    apps.push(testApp);
    const response = await request(testApp.server)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'client-chosen-id-1');
    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('honours well-formed inbound ids when TRUST_REQUEST_ID_HEADER is enabled', async () => {
    const testApp = await createTestApp({ TRUST_REQUEST_ID_HEADER: 'true' });
    apps.push(testApp);
    const response = await request(testApp.server)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'proxy-trace-0001');
    expect(response.headers['x-request-id']).toBe('proxy-trace-0001');
  });

  it.each(['short', 'has spaces in it', 'x'.repeat(129), 'inject\\nnewline-attempt'])(
    'replaces a malformed inbound id %j even when trusted',
    async (inbound) => {
      const testApp = await createTestApp({ TRUST_REQUEST_ID_HEADER: 'true' });
      apps.push(testApp);
      const response = await request(testApp.server)
        .get('/api/v1/health/live')
        .set('X-Request-Id', inbound);
      expect(response.headers['x-request-id']).toMatch(UUID);
    },
  );
});

describe('OpenAPI documentation', () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((testApp) => testApp.close()));
  });

  it('serves the OpenAPI document derived from the shared contracts when enabled', async () => {
    const testApp = await createTestApp({ OPENAPI_ENABLED: 'true' });
    apps.push(testApp);
    const response = await request(testApp.server).get('/api/docs/openapi.json').expect(200);
    const document = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/health/live',
        '/api/v1/health/ready',
        '/api/v1/system/status',
      ]),
    );
    // Shared schemas are hoisted into components and referenced.
    const readyRef =
      response.body.paths['/api/v1/health/ready'].get.responses['200'].content['application/json']
        .schema;
    expect(readyRef).toEqual({ $ref: '#/components/schemas/Readiness' });
    const readySchema = response.body.components.schemas.Readiness;
    expect(readySchema.properties.status.enum).toEqual(['ok', 'degraded', 'error']);

    const ui = await request(testApp.server).get('/api/docs/').expect(200);
    expect(ui.headers['content-security-policy']).toContain("script-src 'self'");
    expect(ui.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('does not expose documentation routes when disabled', async () => {
    const testApp = await createTestApp({ OPENAPI_ENABLED: 'false' });
    apps.push(testApp);
    await request(testApp.server).get('/api/docs/openapi.json').expect(404);
    await request(testApp.server).get('/api/docs/').expect(404);
  });
});
