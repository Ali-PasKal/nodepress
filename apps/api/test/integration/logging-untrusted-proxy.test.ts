import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LogCapture } from '../helpers/log-capture.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('client address logging without a trusted proxy', () => {
  const capture = new LogCapture();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ LOG_LEVEL: 'info' }, { logDestination: capture });
  });
  afterAll(() => testApp.close());

  it('ignores X-Forwarded-For so clients cannot spoof their logged address', async () => {
    const response = await request(testApp.server)
      .get('/api/v1/system/status')
      .set('X-Forwarded-For', '203.0.113.9');
    const entry = capture.accessLogFor(String(response.headers['x-request-id']));
    expect(entry).toBeDefined();
    expect((entry?.req as { remoteAddress?: string }).remoteAddress).toMatch(/127\.0\.0\.1|::1/);
  });
});
