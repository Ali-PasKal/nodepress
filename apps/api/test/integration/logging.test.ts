import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LogCapture } from '../helpers/log-capture.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('structured request logging', () => {
  const capture = new LogCapture();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(
      { LOG_LEVEL: 'info', TRUST_PROXY: '1' },
      { logDestination: capture },
    );
  });
  afterAll(() => testApp.close());

  const requestIdOf = (response: { headers: Record<string, unknown> }) =>
    response.headers['x-request-id'] as string;

  it('writes one JSON access log line per request, correlated by request id', async () => {
    const response = await request(testApp.server).get('/api/v1/system/status').expect(200);
    const entry = capture.accessLogFor(requestIdOf(response));
    expect(entry).toMatchObject({
      level: 30,
      requestId: requestIdOf(response),
      req: { method: 'GET', path: '/api/v1/system/status' },
      res: { statusCode: 200 },
    });
    expect(typeof entry?.responseTime).toBe('number');
    expect(capture.lines.filter((line) => line.requestId === requestIdOf(response))).toHaveLength(
      1,
    );
  });

  it('never logs query strings, credentials or cookies', async () => {
    await request(testApp.server)
      .get('/api/v1/system/status?resetToken=super-secret-token')
      .set('Authorization', 'Bearer secret-bearer-token')
      .set('Cookie', 'session=secret-session-cookie')
      .expect(200);
    expect(capture.raw.join('\n')).not.toMatch(
      /super-secret-token|secret-bearer-token|secret-session-cookie/,
    );
  });

  it('logs 4xx responses at warn level', async () => {
    const response = await request(testApp.server).get('/api/v1/nope').expect(404);
    expect(capture.accessLogFor(requestIdOf(response))).toMatchObject({
      level: 40,
      res: { statusCode: 404 },
    });
  });

  it('records the client address resolved through the trusted proxy', async () => {
    const response = await request(testApp.server)
      .get('/api/v1/system/status')
      .set('X-Forwarded-For', '203.0.113.9');
    const entry = capture.accessLogFor(requestIdOf(response));
    expect((entry?.req as { remoteAddress?: string }).remoteAddress).toBe('203.0.113.9');
  });

  it('does not log successful health probes', async () => {
    const response = await request(testApp.server).get('/api/v1/health/live').expect(200);
    expect(capture.accessLogFor(requestIdOf(response))).toBeUndefined();
  });
});
