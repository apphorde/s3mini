import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerRoutes } from '../handlers/router.js';
import { FakeS3 } from '../storage/fakes3.js';

describe('S3 HTTP routes', () => {
  let app: ReturnType<typeof Fastify>;
  let s3: FakeS3;
  let bucket: string;

  beforeEach(async () => {
    bucket = `http-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    s3 = new FakeS3();
    await s3.init();
    app = Fastify();
    await registerRoutes(app, s3);
  });

  afterEach(async () => {
    await app.close();
    await s3.clearBucket(bucket);
    await s3.close();
  });

  it('supports bucket and object CRUD over HTTP', async () => {
    expect((await app.inject({ method: 'PUT', url: `/${bucket}` })).statusCode).toBe(200);
    const put = await app.inject({ method: 'PUT', url: `/${bucket}/hello.txt`, headers: { 'content-type': 'text/plain' }, payload: 'hello' });
    expect(put.statusCode).toBe(200);
    expect(put.body).toContain('PutObjectResult');

    const get = await app.inject({ method: 'GET', url: `/${bucket}/hello.txt` });
    expect(get.statusCode).toBe(200);
    expect(get.body).toBe('hello');
    expect(get.headers.etag).toBeTruthy();

    expect((await app.inject({ method: 'HEAD', url: `/${bucket}/hello.txt` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/${bucket}/hello.txt` })).statusCode).toBe(204);
  });

  it('supports listing, ranges, and conditional requests', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/a.txt`, headers: { 'content-type': 'application/octet-stream' }, payload: 'abcdef' });
    await app.inject({ method: 'PUT', url: `/${bucket}/dir/b.txt`, headers: { 'content-type': 'application/octet-stream' }, payload: 'b' });

    const list = await app.inject({ method: 'GET', url: `/${bucket}?delimiter=/&max-keys=1` });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('<Key>a.txt</Key>');
    expect(list.body).toContain('<IsTruncated>true</IsTruncated>');

    const full = await app.inject({ method: 'GET', url: `/${bucket}/a.txt` });
    const range = await app.inject({ method: 'GET', url: `/${bucket}/a.txt`, headers: { range: 'bytes=1-3' } });
    expect(range.statusCode).toBe(206);
    expect(range.body).toBe('bcd');
    expect(range.headers['content-range']).toBe('bytes 1-3/6');

    const notModified = await app.inject({ method: 'GET', url: `/${bucket}/a.txt`, headers: { 'if-none-match': full.headers.etag as string } });
    expect(notModified.statusCode).toBe(304);
  });

  it('supports bucket versioning and tagging query operations', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    expect((await app.inject({ method: 'PUT', url: `/${bucket}?versioning`, headers: { 'content-type': 'text/xml' }, payload: '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>' })).statusCode).toBe(200);
    const versioning = await app.inject({ method: 'GET', url: `/${bucket}?versioning` });
    expect(versioning.body).toContain('<Status>Enabled</Status>');

    const tagging = '<Tagging><TagSet><Tag><Key>team</Key><Value>storage</Value></Tag></TagSet></Tagging>';
    expect((await app.inject({ method: 'PUT', url: `/${bucket}?tagging`, headers: { 'content-type': 'text/xml' }, payload: tagging })).statusCode).toBe(200);
    const tags = await app.inject({ method: 'GET', url: `/${bucket}?tagging` });
    expect(tags.body).toContain('<Key>team</Key>');
  });

  it('supports multipart uploads over HTTP', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const initiated = await app.inject({ method: 'POST', url: `/${bucket}/multi.bin?uploads` });
    expect(initiated.statusCode).toBe(200);
    const uploadId = initiated.body.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
    expect(uploadId).toBeTruthy();

    const part = await app.inject({ method: 'PUT', url: `/${bucket}/multi.bin?uploadId=${uploadId}&partNumber=1`, headers: { 'content-type': 'application/octet-stream' }, payload: 'multipart' });
    expect(part.statusCode).toBe(200);
    const etag = part.headers.etag as string;
    const completed = await app.inject({
      method: 'POST',
      url: `/${bucket}/multi.bin?uploadId=${uploadId}`,
      headers: { 'content-type': 'application/xml' },
      payload: `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${etag}</ETag></Part></CompleteMultipartUpload>`,
    });
    expect(completed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/${bucket}/multi.bin` })).body).toBe('multipart');
  });
});
