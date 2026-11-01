import { mediaDetailSchema, mediaListResponseSchema, type MediaDetail } from '@nexora/shared';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobWorker } from '../../src/modules/jobs/job-worker.service.js';
import {
  STORAGE_DRIVER,
  type StorageDriver,
} from '../../src/modules/media/storage/storage-driver.js';
import { createEntry, signInAs } from '../helpers/content.js';
import {
  createIdentityApp,
  install,
  OWNER,
  resetIdentityData,
  signIn,
  withDb,
  type SignedIn,
} from '../helpers/identity.js';
import { MINIMAL_PDF, phonePhoto, pixelBombPng, pngImage, upload } from '../helpers/media.js';
import type { TestApp } from '../helpers/test-app.js';
import { TEST_S3_BUCKET, TEST_S3_ENDPOINT } from '../helpers/test-env.js';

function fetchBinary(app: TestApp, url: string, headers: Record<string, string> = {}) {
  let req = request(app.server)
    .get(url)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        callback(null, Buffer.concat(chunks));
      });
    });
  for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
  return req;
}

function mediaLibraryTests(name: string, overrides: () => Record<string, string>) {
  describe(name, () => {
    let testApp: TestApp;
    let owner: SignedIn;
    let editor: SignedIn;
    let author: SignedIn;
    let contributor: SignedIn;
    let viewer: SignedIn;
    let worker: JobWorker;
    let storage: StorageDriver;
    beforeAll(async () => {
      await resetIdentityData();
      testApp = await createIdentityApp({ MEDIA_MAX_UPLOAD_MB: '2', ...overrides() });
      worker = testApp.app.get(JobWorker);
      storage = testApp.app.get(STORAGE_DRIVER);
      await install(testApp.server);
      owner = await signIn(testApp.server, OWNER.email, OWNER.password);
      editor = await signInAs(testApp.server, owner, 'editor');
      author = await signInAs(testApp.server, owner, 'author');
      contributor = await signInAs(testApp.server, owner, 'contributor');
      viewer = await signInAs(testApp.server, owner, 'viewer');
    });
    afterAll(() => testApp.close());

    it('re-encodes photos without metadata, applies orientation, and generates variants in a job', async () => {
      const response = await upload(author, await phonePhoto(2000, 1000), 'Holiday Photo (1).JPG', {
        contentType: 'image/jpeg',
        fields: { altText: 'A red square' },
      }).expect(201);
      const media = mediaDetailSchema.parse(response.body);
      // Orientation 6 means the stored image is rotated: 1000 × 2000.
      expect(media).toMatchObject({
        filename: 'Holiday Photo (1).JPG',
        title: 'Holiday Photo (1)',
        altText: 'A red square',
        mimeType: 'image/jpeg',
        kind: 'image',
        width: 1000,
        height: 2000,
        variants: [],
        permissions: { edit: true, delete: true },
      });
      expect(media.url).toMatch(
        /^\/uploads\/\d{4}\/\d{2}\/[A-Za-z0-9_-]{12}\/holiday-photo-1\.jpg$/,
      );

      // The fixture really carries orientation 6 and GPS data before upload.
      const original = await sharp(await phonePhoto(2000, 1000)).metadata();
      expect(original.orientation).toBe(6);
      expect(original.exif?.includes(Buffer.from('TestCam'))).toBe(true);
      const stored = await fetchBinary(testApp, media.url).expect(200);
      const metadata = await sharp(stored.body as Buffer).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect([metadata.width, metadata.height]).toEqual([1000, 2000]);

      expect(await worker.drain()).toBe(1);
      const processed = mediaDetailSchema.parse(
        (await author.agent.get(`/api/v1/media/${media.id}`).expect(200)).body,
      );
      expect(processed.variants.map((variant) => [variant.width, variant.height])).toEqual([
        [320, 640],
        [768, 1536],
      ]);
      expect(processed.thumbnailUrl).toBe(processed.variants[0]!.url);
      const variant = await fetchBinary(testApp, processed.variants[0]!.url).expect(200);
      expect(variant.headers['content-type']).toBe('image/webp');
      expect((await sharp(variant.body as Buffer).metadata()).width).toBe(320);
    });

    it('identifies files by content, not by name or declared type', async () => {
      const html = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');
      const disguised = await upload(author, html, 'photo.jpg', {
        contentType: 'image/jpeg',
      }).expect(415);
      expect(disguised.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      await upload(author, svg, 'logo.svg', { contentType: 'image/svg+xml' }).expect(415);

      // A real PNG named .txt is accepted as a PNG.
      const png = mediaDetailSchema.parse(
        (
          await upload(author, await pngImage(40, 30), 'notes.txt', {
            contentType: 'text/plain',
          }).expect(201)
        ).body,
      );
      expect(png).toMatchObject({ mimeType: 'image/png', width: 40, height: 30 });
      expect(png.url).toMatch(/\/notes\.png$/);

      // Bytes appended to an image (a polyglot) do not survive re-encoding.
      const polyglot = Buffer.concat([
        await pngImage(20, 20),
        Buffer.from('<script>alert(1)</script>'),
      ]);
      const cleaned = mediaDetailSchema.parse(
        (await upload(author, polyglot, 'poly.png').expect(201)).body,
      );
      const storedPolyglot = await fetchBinary(testApp, cleaned.url).expect(200);
      expect((storedPolyglot.body as Buffer).includes('<script>')).toBe(false);
    });

    it('enforces size and pixel limits', async () => {
      const tooLarge = Buffer.concat([MINIMAL_PDF, Buffer.alloc(3 * 1024 * 1024)]);
      const big = await upload(author, tooLarge, 'big.pdf').expect(413);
      expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      const bomb = await upload(author, pixelBombPng(), 'bomb.png').expect(422);
      expect(bomb.body.error.issues[0].message).toMatch(/could not be read/);
      await upload(author, Buffer.alloc(0), 'empty.png').expect(422);
    });

    it('serves files safely: types, sandboxing, caching, ranges, and no traversal', async () => {
      const pdf = mediaDetailSchema.parse(
        (await upload(author, MINIMAL_PDF, 'Report 2026.pdf').expect(201)).body,
      );
      expect(pdf).toMatchObject({
        kind: 'document',
        mimeType: 'application/pdf',
        thumbnailUrl: null,
        width: null,
      });
      const full = await fetchBinary(testApp, pdf.url).expect(200);
      expect(full.headers).toMatchObject({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="report-2026.pdf"',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'public, max-age=31536000, immutable',
        'cross-origin-resource-policy': 'cross-origin',
        'accept-ranges': 'bytes',
      });
      expect(full.body).toEqual(MINIMAL_PDF);

      const partial = await fetchBinary(testApp, pdf.url, { Range: 'bytes=0-7' }).expect(206);
      expect((partial.body as Buffer).toString()).toBe('%PDF-1.4');
      expect(partial.headers['content-range']).toBe(`bytes 0-7/${String(MINIMAL_PDF.length)}`);
      const suffix = await fetchBinary(testApp, pdf.url, { Range: 'bytes=-6' }).expect(206);
      expect((suffix.body as Buffer).toString()).toBe('%%EOF\n');
      await fetchBinary(testApp, pdf.url, { Range: 'bytes=999999-' }).expect(416);
      await request(testApp.server).head(pdf.url).expect(200);
      await request(testApp.server).post(pdf.url).expect(405);

      for (const path of [
        '/uploads/..%2F..%2F..%2Fetc%2Fpasswd',
        '/uploads/../package.json',
        '/uploads/2026/11/AAAAAAAAAAAA/evil.html',
        '/uploads/2026/11/AAAAAAAAAAAA/missing.png',
        '/uploads/%E0%A4%A',
      ]) {
        const response = await request(testApp.server).get(path);
        expect([404, 400], path).toContain(response.status);
      }
    });

    it('applies upload and ownership permissions', async () => {
      await upload(contributor, await pngImage(10, 10), 'c.png').expect(403);
      await upload(viewer, await pngImage(10, 10), 'v.png').expect(403);
      await upload(author, await pngImage(10, 10), 'no-csrf.png', { csrf: false }).expect(403);

      const editorFile = mediaDetailSchema.parse(
        (await upload(editor, await pngImage(10, 10), 'e.png').expect(201)).body,
      );
      const authorFile = mediaDetailSchema.parse(
        (await upload(author, await pngImage(10, 10), 'a.png').expect(201)).body,
      );
      // Viewers may browse (content.read); authors cannot edit others' files; editors can.
      const viewerList = mediaListResponseSchema.parse(
        (await viewer.agent.get('/api/v1/media?kind=image').expect(200)).body,
      );
      expect(viewerList.items.find((item) => item.id === editorFile.id)?.permissions).toEqual({
        edit: false,
        delete: false,
      });
      await contributor.agent.get('/api/v1/media').expect(403);
      await author.agent
        .patch(`/api/v1/media/${editorFile.id}`)
        .set('X-CSRF-Token', author.csrf)
        .send({ altText: 'not mine' })
        .expect(403);
      const edited = await editor.agent
        .patch(`/api/v1/media/${authorFile.id}`)
        .set('X-CSRF-Token', editor.csrf)
        .send({ altText: 'Described by an editor', title: 'Renamed' })
        .expect(200);
      expect(edited.body).toMatchObject({ altText: 'Described by an editor', title: 'Renamed' });

      const mine = mediaListResponseSchema.parse(
        (await author.agent.get('/api/v1/media?mine=true&search=a.png').expect(200)).body,
      );
      expect(mine.items.map((item) => item.id)).toEqual([authorFile.id]);
      expect((await author.agent.get('/api/v1/media/limits').expect(200)).body).toMatchObject({
        maxUploadBytes: 2 * 1024 * 1024,
      });
    });

    it('deletes files durably and detaches them from entries', async () => {
      const image: MediaDetail = mediaDetailSchema.parse(
        (await upload(editor, await phonePhoto(800, 600), 'featured.jpg').expect(201)).body,
      );
      await worker.drain();
      const withVariants = mediaDetailSchema.parse(
        (await editor.agent.get(`/api/v1/media/${image.id}`).expect(200)).body,
      );
      const post = await createEntry(editor, { title: 'Illustrated', featuredMediaId: image.id });
      expect(post.featuredMedia).toMatchObject({ id: image.id, altText: '' });
      expect(
        (await editor.agent.get(`/api/v1/media/${image.id}`).expect(200)).body.usageCount,
      ).toBe(1);
      const pdf = mediaDetailSchema.parse(
        (await upload(editor, MINIMAL_PDF, 'doc.pdf').expect(201)).body,
      );
      await createEntry(editor, { title: 'PDF as featured', featuredMediaId: pdf.id }, 422);

      await editor.agent
        .delete(`/api/v1/media/${image.id}`)
        .set('X-CSRF-Token', editor.csrf)
        .expect(204);
      await editor.agent.get(`/api/v1/media/${image.id}`).expect(404);
      const after = await editor.agent.get(`/api/v1/entries/${post.id}`).expect(200);
      expect(after.body.featuredMedia).toBeNull();

      const keys = [image.url, ...withVariants.variants.map((variant) => variant.url)].map((url) =>
        decodeURIComponent(url.replace('/uploads/', '')),
      );
      expect(await storage.size(keys[0]!)).not.toBeNull();
      await worker.drain();
      for (const key of keys) expect(await storage.size(key)).toBeNull();
      const audit = await withDb(
        async (db) =>
          (
            await db.query(
              `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at`,
              [image.id],
            )
          ).rows as { action: string }[],
      );
      expect(audit.map((row) => row.action)).toEqual(['media.uploaded', 'media.deleted']);
    });
  });
}

mediaLibraryTests('media library (local storage)', () => ({}));

describe.runIf(TEST_S3_ENDPOINT !== undefined)('S3 storage driver', () => {
  mediaLibraryTests('media library (S3-compatible storage)', () => ({
    MEDIA_STORAGE: 's3',
    S3_BUCKET: TEST_S3_BUCKET,
    S3_ENDPOINT: TEST_S3_ENDPOINT ?? '',
    S3_FORCE_PATH_STYLE: 'true',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test-secret',
  }));
});
