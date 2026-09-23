import Fastify from 'fastify';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRoutes } from '../handlers/router.js';
import { S3Mini } from '../storage/s3mini.js';

describe('S3 HTTP routes', () => {
  let app: ReturnType<typeof Fastify>;
  let s3: S3Mini;
  let bucket: string;

  beforeEach(async () => {
    delete process.env.S3MINI_ACCESS_KEY;
    delete process.env.S3MINI_SECRET_KEY;
    bucket = `http-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    s3 = new S3Mini();
    await s3.init();
    app = Fastify();
    await registerRoutes(app, s3);
  });

  afterEach(async () => {
    delete process.env.S3MINI_ACCESS_KEY;
    delete process.env.S3MINI_SECRET_KEY;
    await app.close();
    await s3.clearBucket(bucket);
    await s3.close();
  });

  it('supports bucket and object CRUD over HTTP', async () => {
    expect((await app.inject({ method: 'PUT', url: `/${bucket}` })).statusCode).toBe(200);
    const put = await app.inject({ method: 'PUT', url: `/${bucket}/hello.txt`, headers: { 'content-type': 'text/plain' }, payload: 'hello' });
    expect(put.statusCode).toBe(200);
    expect(put.body).toContain('PutObjectResult');
    expect(put.headers.etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(put.headers['x-amz-version-id']).toBeTruthy();
    expect(put.headers['x-amz-request-id']).toBeTruthy();
    expect(put.headers['x-amz-id-2']).toBeTruthy();

    const get = await app.inject({ method: 'GET', url: `/${bucket}/hello.txt` });
    expect(get.statusCode).toBe(200);
    expect(get.body).toBe('hello');
    expect(get.headers.etag).toBeTruthy();

    expect((await app.inject({ method: 'HEAD', url: `/${bucket}/hello.txt` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/${bucket}/hello.txt` })).statusCode).toBe(204);
  });

  it('reserves authentication paths from bucket routing', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/object.txt' });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('<Code>NoSuchKey</Code>');
  });

  it('covers bucket listing, location, tags, and configuration deletion', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}?locationConstraint=eu-west-1` });
    const buckets = await app.inject({ method: 'GET', url: '/' });
    expect(buckets.statusCode).toBe(200);
    expect(buckets.body).toContain(`<Name>${bucket}</Name>`);
    expect((await app.inject({ method: 'HEAD', url: `/${bucket}` })).statusCode).toBe(200);

    const location = await app.inject({ method: 'GET', url: `/${bucket}?location` });
    expect(location.body).toContain('eu-west-1');
    const tags = '<Tagging><TagSet><Tag><Key>team</Key><Value>storage</Value></Tag></TagSet></Tagging>';
    expect((await app.inject({ method: 'PUT', url: `/${bucket}?tagging`, headers: { 'content-type': 'application/xml' }, payload: tags })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/${bucket}?tagging` })).body).toContain('<Value>storage</Value>');
    expect((await app.inject({ method: 'DELETE', url: `/${bucket}?tagging` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: `/${bucket}?acl`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ CannedACL: 'private' }) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/${bucket}?acl` })).body).toContain('<CannedACL>private</CannedACL>');
    expect((await app.inject({ method: 'DELETE', url: `/${bucket}?acl` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: `/${bucket}?website`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ index: 'index.html' }) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/${bucket}?website` })).body).toContain('<index>index.html</index>');
    expect((await app.inject({ method: 'DELETE', url: `/${bucket}?website` })).statusCode).toBe(204);
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
    const suffix = await app.inject({ method: 'GET', url: `/${bucket}/a.txt`, headers: { range: 'bytes=-2' } });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.body).toBe('ef');
    const modified = await app.inject({ method: 'GET', url: `/${bucket}/a.txt`, headers: { 'if-modified-since': full.headers['last-modified'] as string } });
    expect(modified.statusCode).toBe(304);

    const notModified = await app.inject({ method: 'GET', url: `/${bucket}/a.txt`, headers: { 'if-none-match': full.headers.etag as string } });
    expect(notModified.statusCode).toBe(304);
  });

  it('supports URL-encoded ListObjectsV2 responses', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/folder/space%20key.txt`, headers: { 'content-type': 'text/plain' }, payload: 'encoded' });
    const list = await app.inject({ method: 'GET', url: `/${bucket}?encoding-type=url` });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('<EncodingType>url</EncodingType>');
    expect(list.body).toContain('folder%2Fspace%20key.txt');
  });

  it('supports ListObjects version 1 pagination', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/a.txt`, headers: { 'content-type': 'text/plain' }, payload: 'a' });
    await app.inject({ method: 'PUT', url: `/${bucket}/b.txt`, headers: { 'content-type': 'text/plain' }, payload: 'b' });
    const first = await app.inject({ method: 'GET', url: `/${bucket}?list-type=1&max-keys=1` });
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain('<ListBucketResult>');
    expect(first.body).toContain('<Key>a.txt</Key>');
    expect(first.body).toContain('<NextMarker>a.txt</NextMarker>');
    const second = await app.inject({ method: 'GET', url: `/${bucket}?list-type=1&marker=a.txt&max-keys=1` });
    expect(second.body).toContain('<Key>b.txt</Key>');
    expect(second.body).not.toContain('<IsTruncated>true</IsTruncated>');
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

  it('accepts lifecycle configuration XML over HTTP', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const lifecycle = '<LifecycleConfiguration><Rule><ID>expire-tmp</ID><Filter><Prefix>tmp/</Prefix></Filter><Status>Enabled</Status><Expiration><Days>0</Days></Expiration></Rule></LifecycleConfiguration>';
    const configured = await app.inject({ method: 'PUT', url: `/${bucket}?lifecycle`, headers: { 'content-type': 'application/xml' }, payload: lifecycle });
    expect(configured.statusCode).toBe(200);
    await app.inject({ method: 'PUT', url: `/${bucket}/tmp/expired.txt`, headers: { 'content-type': 'text/plain' }, payload: 'expired' });
    expect((await app.inject({ method: 'GET', url: `/${bucket}/tmp/expired.txt` })).statusCode).toBe(404);
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

  it('lists and aborts multipart uploads over HTTP', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const initiated = await app.inject({ method: 'POST', url: `/${bucket}/pending.bin?uploads` });
    const uploadId = initiated.body.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
    await app.inject({ method: 'PUT', url: `/${bucket}/pending.bin?uploadId=${uploadId}&partNumber=1`, headers: { 'content-type': 'application/octet-stream' }, payload: 'pending' });
    const parts = await app.inject({ method: 'GET', url: `/${bucket}/pending.bin?uploadId=${uploadId}` });
    expect(parts.statusCode).toBe(200);
    expect(parts.body).toContain('<PartNumber>1</PartNumber>');
    const uploads = await app.inject({ method: 'GET', url: `/${bucket}?uploads` });
    expect(uploads.statusCode).toBe(200);
    expect(uploads.body).toContain('<Key>pending.bin</Key>');
    expect((await app.inject({ method: 'DELETE', url: `/${bucket}/pending.bin?uploadId=${uploadId}` })).statusCode).toBe(204);
  });

  it('validates and returns SHA-256 checksums', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const body = 'checksum';
    const checksum = crypto.createHash('sha256').update(body).digest('base64');
    const put = await app.inject({ method: 'PUT', url: `/${bucket}/checksum.txt`, headers: { 'content-type': 'text/plain', 'x-amz-checksum-sha256': checksum }, payload: body });
    expect(put.statusCode).toBe(200);
    expect(put.headers['x-amz-checksum-sha256']).toBe(checksum);
    const bad = await app.inject({ method: 'PUT', url: `/${bucket}/bad.txt`, headers: { 'content-type': 'text/plain', 'x-amz-checksum-sha256': 'bad' }, payload: body });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('<Code>BadDigest</Code>');
  });

  it('validates Content-MD5 and preserves Content-Language', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const body = 'md5 body';
    const digest = crypto.createHash('md5').update(body).digest('base64');
    const put = await app.inject({ method: 'PUT', url: `/${bucket}/md5.txt`, headers: { 'content-type': 'text/plain', 'content-md5': digest, 'content-language': 'en-US' }, payload: body });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: 'HEAD', url: `/${bucket}/md5.txt` })).headers['content-language']).toBe('en-US');
    const bad = await app.inject({ method: 'PUT', url: `/${bucket}/bad-md5.txt`, headers: { 'content-type': 'text/plain', 'content-md5': 'bad' }, payload: body });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('<Code>BadDigest</Code>');
  });

  it('escapes XML values in S3 error responses', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const response = await app.inject({ method: 'GET', url: `/${bucket}/missing<key>` });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('<key>');
    expect(response.body).toContain('&lt;key&gt;');
  });

  it('validates AWS and Backblaze payload digest headers', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const body = 'payload digests';
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const sha1 = crypto.createHash('sha1').update(body).digest('hex');
    const good = await app.inject({ method: 'PUT', url: `/${bucket}/digests.txt`, headers: { 'content-type': 'text/plain', 'x-amz-content-sha256': sha256, 'x-bz-content-sha1': sha1 }, payload: body });
    expect(good.statusCode, good.body).toBe(200);
    const bad = await app.inject({ method: 'PUT', url: `/${bucket}/bad-digest.txt`, headers: { 'content-type': 'text/plain', 'x-bz-content-sha1': 'bad' }, payload: body });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('<Code>BadDigest</Code>');
  });

  it('rejects unsupported storage classes', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const response = await app.inject({ method: 'PUT', url: `/${bucket}/invalid-class.txt`, headers: { 'content-type': 'text/plain', 'x-amz-storage-class': 'MADE_UP' }, payload: 'invalid' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('<Code>InvalidStorageClass</Code>');
  });

  it('persists supported server-side encryption metadata', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const put = await app.inject({ method: 'PUT', url: `/${bucket}/encrypted.txt`, headers: { 'content-type': 'text/plain', 'x-amz-server-side-encryption': 'AES256' }, payload: 'secret' });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/${bucket}/encrypted.txt` });
    expect(get.headers['x-amz-server-side-encryption']).toBe('AES256');
    const invalid = await app.inject({ method: 'PUT', url: `/${bucket}/invalid.txt`, headers: { 'content-type': 'text/plain', 'x-amz-server-side-encryption': 'aws:kms' }, payload: 'secret' });
    expect(invalid.statusCode).toBe(400);
  });

  it('enforces object retention during deletion', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    const retained = await app.inject({
      method: 'PUT',
      url: `/${bucket}/retained.txt`,
      headers: { 'content-type': 'text/plain', 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': new Date(Date.now() + 60_000).toISOString() },
      payload: 'retained',
    });
    expect(retained.statusCode).toBe(200);
    const blocked = await app.inject({ method: 'DELETE', url: `/${bucket}/retained.txt` });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body).toContain('<Code>AccessDenied</Code>');
  });

  it('lists object versions over HTTP', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}?versioning`, headers: { 'content-type': 'text/xml' }, payload: '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>' });
    await app.inject({ method: 'PUT', url: `/${bucket}/versioned.txt`, headers: { 'content-type': 'text/plain' }, payload: 'one' });
    await app.inject({ method: 'PUT', url: `/${bucket}/versioned.txt`, headers: { 'content-type': 'text/plain' }, payload: 'two' });
    const versions = await app.inject({ method: 'GET', url: `/${bucket}?versions` });
    expect(versions.statusCode).toBe(200);
    expect(versions.body).toContain('<Key>versioned.txt</Key>');
    expect((versions.body.match(/<VersionId>/g) || []).length).toBe(2);
  });

  it('enforces configured CORS preflight rules', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({
      method: 'PUT',
      url: `/${bucket}?cors`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ rules: [{ allowedOrigins: ['https://client.example'], allowedMethods: ['GET'], allowedHeaders: ['x-test'], maxAgeSeconds: 300 }] }),
    });
    const allowed = await app.inject({ method: 'OPTIONS', url: `/${bucket}/object`, headers: { origin: 'https://client.example', 'access-control-request-method': 'GET' } });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://client.example');
    const denied = await app.inject({ method: 'OPTIONS', url: `/${bucket}/object`, headers: { origin: 'https://other.example', 'access-control-request-method': 'GET' } });
    expect(denied.statusCode).toBe(403);
  });

  it('supports restore and basic select object content', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/data.csv`, headers: { 'content-type': 'text/csv' }, payload: 'id,name\n1,one\n' });
    const restored = await app.inject({ method: 'POST', url: `/${bucket}/data.csv?restore`, headers: { 'content-type': 'application/xml' }, payload: '<RestoreObjectRequest />' });
    expect(restored.statusCode).toBe(202);
    const selected = await app.inject({ method: 'POST', url: `/${bucket}/data.csv?select&select-type=2`, headers: { 'content-type': 'application/xml' }, payload: '<SelectObjectContentRequest><Expression>SELECT * FROM S3Object</Expression></SelectObjectContentRequest>' });
    expect(selected.statusCode).toBe(200);
    expect(selected.body).toContain('id,name');
  });

  it('supports UploadPartCopy', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/source.bin`, headers: { 'content-type': 'application/octet-stream' }, payload: 'copied-part' });
    const initiated = await app.inject({ method: 'POST', url: `/${bucket}/destination.bin?uploads` });
    const uploadId = initiated.body.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
    const copied = await app.inject({ method: 'PUT', url: `/${bucket}/destination.bin?uploadId=${uploadId}&partNumber=1`, headers: { 'x-amz-copy-source': `/${bucket}/source.bin` } });
    expect(copied.statusCode).toBe(200);
    expect(copied.body).toContain('<CopyPartResult>');
  });

  it('supports object ACL operations', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/acl.txt`, headers: { 'content-type': 'text/plain' }, payload: 'acl' });
    const put = await app.inject({ method: 'PUT', url: `/${bucket}/acl.txt?acl`, headers: { 'x-amz-acl': 'public-read' } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/${bucket}/acl.txt?acl` });
    expect(get.statusCode).toBe(200);
    expect(get.body).toContain('<CannedACL>public-read</CannedACL>');
  });

  it('supports object copy, tagging deletion, and batch deletion', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/source.txt`, headers: { 'content-type': 'text/plain' }, payload: 'source' });
    const copied = await app.inject({ method: 'PUT', url: `/${bucket}/copy.txt`, headers: { 'x-amz-copy-source': `/${bucket}/source.txt` } });
    expect(copied.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/${bucket}/copy.txt` })).body).toBe('source');
    const tagXml = '<Tagging><TagSet><Tag><Key>temporary</Key><Value>true</Value></Tag></TagSet></Tagging>';
    await app.inject({ method: 'PUT', url: `/${bucket}/copy.txt?tagging`, headers: { 'content-type': 'application/xml' }, payload: tagXml });
    expect((await app.inject({ method: 'DELETE', url: `/${bucket}/copy.txt?tagging` })).statusCode).toBe(204);
    const deleted = await app.inject({ method: 'POST', url: `/${bucket}?delete`, headers: { 'content-type': 'application/xml' }, payload: '<Delete><Object><Key>source.txt</Key></Object><Object><Key>copy.txt</Key></Object></Delete>' });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.body).toContain('<Key>source.txt</Key>');
    expect(deleted.body).toContain('<Key>copy.txt</Key>');
  });

  it('enforces explicit public bucket policy denies', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({
      method: 'PUT',
      url: `/${bucket}?policy`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ statements: [{ effect: 'Deny', principal: '*', action: 's3:PutObject', resource: `arn:aws:s3:::${bucket}/*` }] }),
    });
    const denied = await app.inject({ method: 'PUT', url: `/${bucket}/blocked.txt`, headers: { 'content-type': 'text/plain' }, payload: 'blocked' });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).toContain('<Code>AccessDenied</Code>');
  });

  it('enforces policy allows, wildcard resources, and string conditions', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/allowed.txt`, headers: { 'content-type': 'text/plain' }, payload: 'allowed' });
    await app.inject({
      method: 'PUT',
      url: `/${bucket}?policy`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ statements: [{ effect: 'Allow', principal: '*', action: 's3:GetObject', resource: `arn:aws:s3:::${bucket}/allowed*`, condition: { StringEquals: { 's3:prefix': 'allowed' } } }] }),
    });
    const allowed = await app.inject({ method: 'GET', url: `/${bucket}/allowed.txt?prefix=allowed` });
    expect(allowed.statusCode).toBe(200);
    const denied = await app.inject({ method: 'GET', url: `/${bucket}/allowed.txt?prefix=other` });
    expect(denied.statusCode).toBe(403);
  });

  it('evaluates private and public-read object ACLs for anonymous requests', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/acl.txt`, headers: { 'content-type': 'text/plain' }, payload: 'acl' });
    expect(await s3.isObjectRequestDenied(bucket, 'acl.txt', 'GetObject', 'anonymous')).toBe(true);
    await app.inject({ method: 'PUT', url: `/${bucket}/acl.txt?acl`, headers: { 'x-amz-acl': 'public-read' } });
    const publicRead = await app.inject({ method: 'GET', url: `/${bucket}/acl.txt` });
    expect(publicRead.statusCode).toBe(200);
  });

  it('evaluates XML ACL grants for anonymous reads', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    await app.inject({ method: 'PUT', url: `/${bucket}/grant.txt`, headers: { 'content-type': 'text/plain' }, payload: 'grant' });
    const acl = '<AccessControlPolicy><AccessControlList><Grant><Grantee><Type>Group</Type><URI>http://acs.amazonaws.com/groups/global/AllUsers</URI></Grantee><Permission>READ</Permission></Grant></AccessControlList></AccessControlPolicy>';
    await app.inject({ method: 'PUT', url: `/${bucket}/grant.txt?acl`, headers: { 'content-type': 'application/xml' }, payload: acl });
    expect((await app.inject({ method: 'GET', url: `/${bucket}/grant.txt` })).statusCode).toBe(200);
  });

  it('protects the access-key control plane with an admin bearer token', async () => {
    process.env.S3MINI_ADMIN_TOKEN = 'test-admin-token';
    const denied = await app.inject({ method: 'GET', url: '/admin/access-keys' });
    expect(denied.statusCode).toBe(403);
    const created = await app.inject({ method: 'POST', url: '/admin/access-keys', headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' }, payload: JSON.stringify({ displayName: 'control-plane-test' }) });
    expect(created.statusCode).toBe(201);
    const credentials = created.json() as { accessKeyId: string; secretAccessKey: string };
    expect(credentials.secretAccessKey).toBeTruthy();
    const listed = await app.inject({ method: 'GET', url: '/admin/access-keys', headers: { authorization: 'Bearer test-admin-token' } });
    expect(listed.body).toContain(credentials.accessKeyId);
    expect(listed.body).not.toContain(credentials.secretAccessKey);
    expect((await app.inject({ method: 'DELETE', url: `/admin/access-keys/${credentials.accessKeyId}`, headers: { authorization: 'Bearer test-admin-token' } })).statusCode).toBe(204);
    delete process.env.S3MINI_ADMIN_TOKEN;
  });

  it('requires authentication for mutating S3 requests when static credentials are configured', async () => {
    process.env.S3MINI_ACCESS_KEY = 's3mini';
    process.env.S3MINI_SECRET_KEY = 's3mini-secret';
    const denied = await app.inject({ method: 'PUT', url: `/${bucket}` });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).toContain('<Code>AccessDenied</Code>');
    delete process.env.S3MINI_ACCESS_KEY;
    delete process.env.S3MINI_SECRET_KEY;
  });

  it('manages buckets and policies through the admin control plane', async () => {
    process.env.S3MINI_ADMIN_TOKEN = 'test-admin-token';
    const managedBucket = `${bucket}-managed`;
    const created = await app.inject({ method: 'POST', url: '/admin/buckets', headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' }, payload: JSON.stringify({ name: managedBucket }) });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/admin/buckets', headers: { authorization: 'Bearer test-admin-token' } })).json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: managedBucket })]));
    expect((await app.inject({ method: 'GET', url: '/admin/replication/health', headers: { authorization: 'Bearer test-admin-token' } })).statusCode).toBe(200);
    const policy = { statements: [{ effect: 'Deny', principal: '*', action: 's3:PutObject', resource: `arn:aws:s3:::${managedBucket}/*` }] };
    expect((await app.inject({ method: 'PUT', url: `/admin/buckets/${managedBucket}/policy`, headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' }, payload: JSON.stringify(policy) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/admin/buckets/${managedBucket}/policy`, headers: { authorization: 'Bearer test-admin-token' } })).json()).toEqual(policy);
    expect((await app.inject({ method: 'DELETE', url: `/admin/buckets/${managedBucket}/policy`, headers: { authorization: 'Bearer test-admin-token' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/admin/buckets/${managedBucket}`, headers: { authorization: 'Bearer test-admin-token' } })).statusCode).toBe(204);
    delete process.env.S3MINI_ADMIN_TOKEN;
  });

  it('exposes dead-letter replication events and supports operator retry', async () => {
    process.env.S3MINI_ADMIN_TOKEN = 'test-admin-token';
    await s3.createBucket(bucket);
    await s3.putObject(bucket, 'dead-letter.txt', Buffer.from('event'), {});
    const event = (await s3.listReplicationEvents()).find(item => item.key === 'dead-letter.txt');
    await s3.updateReplicationEvent(event!.id, 'DeadLetter', 8);
    const listed = await app.inject({ method: 'GET', url: '/admin/replication/events?status=DeadLetter', headers: { authorization: 'Bearer test-admin-token' } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: event!.id, status: 'DeadLetter' })]));
    expect((await app.inject({ method: 'POST', url: `/admin/replication/events/${event!.id}/retry`, headers: { authorization: 'Bearer test-admin-token' } })).statusCode).toBe(204);
    expect((await s3.listReplicationEvents()).find(item => item.id === event!.id)?.status).toBe('Pending');
    delete process.env.S3MINI_ADMIN_TOKEN;
  });

  it('exposes replication quorum and degraded-state summary', async () => {
    process.env.S3MINI_ADMIN_TOKEN = 'test-admin-token';
    process.env.S3MINI_REPLICATION_PEERS = 'http://one.test,http://two.test';
    process.env.S3MINI_REPLICATION_QUORUM = '2';
    const summary = await app.inject({ method: 'GET', url: '/admin/replication/summary', headers: { authorization: 'Bearer test-admin-token' } });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ configuredPeers: 2, quorum: 2, degraded: true, healthyPeers: 0 });
    delete process.env.S3MINI_ADMIN_TOKEN;
    delete process.env.S3MINI_REPLICATION_PEERS;
    delete process.env.S3MINI_REPLICATION_QUORUM;
  });

  it('serves the dependency-free control-plane dashboard', async () => {
    const dashboard = await app.inject({ method: 'GET', url: '/admin' });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.headers['content-type']).toContain('text/html');
    expect(dashboard.body).toContain('S3MINI Control Plane');
    expect(dashboard.body).toContain('Replication');
    expect(dashboard.body).toContain('/admin/replication/events');
    expect(dashboard.body).toContain('@li3/web');
    expect(dashboard.body).toContain('data-panel="overview"');
    expect(dashboard.body).toContain('Storage consumption');
    expect(dashboard.body).toContain('data-view="buckets"');
    expect(dashboard.body).toContain('data-copy="secret"');
    expect(dashboard.body).toContain('credential-value secret');
    expect(dashboard.body).toContain('S3MINI_OIDC_ADMIN_EMAILS');
    expect(dashboard.body).toContain('data-save-policy');
    expect(dashboard.body).toContain('id="mobile-menu"');
    expect(dashboard.body).toContain('id="sidebar-close"');
    expect(dashboard.body).toContain('/admin/profile');
    expect(dashboard.body).toContain('id="sidebar-profile-name"');
  });

  it('redirects dashboard access to OIDC when configured', async () => {
    process.env.S3MINI_OIDC_CLIENT_ID = 's3mini-dashboard';
    process.env.S3MINI_OIDC_CLIENT_SECRET = 'secret';
    const response = await app.inject({ method: 'GET', url: '/admin' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/admin/login');
    const login = await app.inject({ method: 'GET', url: '/admin/login' });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toContain('https://auth.api.apphor.de/authorize');
    expect(login.headers['set-cookie']).toContain('s3mini_oidc_state=');
    expect(login.headers['set-cookie']).toContain('Path=/;');
    delete process.env.S3MINI_OIDC_CLIENT_ID;
    delete process.env.S3MINI_OIDC_CLIENT_SECRET;
  });

  it('accepts the live OIDC environment variable names', async () => {
    process.env.AUTH_PROVIDER = 'https://auth.api.apphor.de/api';
    process.env.OIDC_CLIENT_ID = 'live-client';
    process.env.OIDC_CLIENT_SECRET = 'live-secret';
    process.env.OIDC_REDIRECT_URI = 'https://storage.example.com/auth/callback';
    const login = await app.inject({ method: 'GET', url: '/admin/login' });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toContain('https://auth.api.apphor.de/authorize');
    expect(login.headers.location).toContain('client_id=live-client');
    expect(login.headers.location).toContain('redirect_uri=https%3A%2F%2Fstorage.example.com%2Fauth%2Fcallback');
    delete process.env.AUTH_PROVIDER;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
  });

  it('exchanges an OIDC callback code and creates an admin session', async () => {
    process.env.S3MINI_OIDC_CLIENT_ID = 's3mini-dashboard';
    process.env.S3MINI_OIDC_CLIENT_SECRET = 'secret';
    const login = await app.inject({ method: 'GET', url: '/admin/login' });
    const stateCookie = String(login.headers['set-cookie']).match(/s3mini_oidc_state=([^;]+)/)?.[1];
    expect(stateCookie).toBeTruthy();
    const state = JSON.parse(Buffer.from(stateCookie!, 'base64url').toString('utf8')) as { state: string };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'issued-access-token' }), { status: 200 })));
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=authorization-code&state=${encodeURIComponent(state.state)}`,
      headers: { cookie: `s3mini_oidc_state=${stateCookie}` },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/admin');
    expect(callback.headers['set-cookie']).toContain('s3mini_oidc_token=issued-access-token');
    vi.unstubAllGlobals();
    delete process.env.S3MINI_OIDC_CLIENT_ID;
    delete process.env.S3MINI_OIDC_CLIENT_SECRET;
  });

  it('authorizes OIDC dashboard API requests with the authenticated user', async () => {
    process.env.S3MINI_OIDC_CLIENT_ID = 's3mini-dashboard';
    process.env.S3MINI_OIDC_CLIENT_SECRET = 'secret';
    process.env.S3MINI_OIDC_ADMIN_EMAILS = 'admin@example.com';
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = keys.publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'https://auth.api.apphor.de', aud: 's3mini-dashboard', sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
    const signed = `${header}.${payload}`;
    const signature = crypto.createSign('RSA-SHA256').update(signed).sign(keys.privateKey).toString('base64url');
    const token = `${signed}.${signature}`;
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => String(input).endsWith('/jwks.json')
      ? Promise.resolve(new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', kty: 'RSA' }] }), { status: 200 }))
      : Promise.resolve(new Response(JSON.stringify({ email: 'admin@example.com' }), { status: 200 }))));
    const response = await app.inject({ method: 'GET', url: '/admin/replication/events', headers: { cookie: `s3mini_oidc_token=${token}` } });
    expect(response.statusCode).toBe(200);
    const profile = await app.inject({ method: 'GET', url: '/admin/profile', headers: { cookie: `s3mini_oidc_token=${token}` } });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ email: 'admin@example.com' });
    vi.unstubAllGlobals();
    delete process.env.S3MINI_OIDC_CLIENT_ID;
    delete process.env.S3MINI_OIDC_CLIENT_SECRET;
    delete process.env.S3MINI_OIDC_ADMIN_EMAILS;
  });

  it('authorizes provider API tokens by S3 scope', async () => {
    process.env.S3MINI_OIDC_CLIENT_ID = 's3mini-dashboard';
    process.env.S3MINI_OIDC_CLIENT_SECRET = 'secret';
    const scopes = new Map([
      ['write-token', 's3:write'],
      ['read-token', 's3:read'],
      ['admin-token', 's3:admin'],
    ]);
    vi.stubGlobal('fetch', vi.fn((_input: string | URL, init?: RequestInit) => {
      const token = new URLSearchParams(String(init?.body || '')).get('token') || '';
      return Promise.resolve(new Response(JSON.stringify({ active: scopes.has(token), scope: scopes.get(token) || '' }), { status: 200 }));
    }));
    const writeHeaders = { authorization: 'Bearer write-token', 'content-type': 'text/plain' };
    expect((await app.inject({ method: 'PUT', url: `/${bucket}`, headers: { authorization: 'Bearer write-token' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/${bucket}/token.txt`, headers: writeHeaders, payload: 'token' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/${bucket}/token.txt`, headers: { authorization: 'Bearer read-token' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/${bucket}/token.txt`, headers: { authorization: 'Bearer write-token' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/replication/events', headers: { authorization: 'Bearer admin-token' } })).statusCode).toBe(200);
    vi.unstubAllGlobals();
    delete process.env.S3MINI_OIDC_CLIENT_ID;
    delete process.env.S3MINI_OIDC_CLIENT_SECRET;
  });

  it('clears the OIDC dashboard session on logout', async () => {
    const response = await app.inject({ method: 'POST', url: '/admin/logout' });
    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain('s3mini_oidc_token=;');
  });

  it('accepts authenticated replicated object writes without creating a replication loop', async () => {
    await app.inject({ method: 'PUT', url: `/${bucket}` });
    process.env.S3MINI_REPLICATION_TOKEN = 'replication-token';
    const body = Buffer.from('replicated body');
    const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
    const replicated = await app.inject({
      method: 'PUT',
      url: '/internal/replication',
      headers: {
        'content-type': 'application/octet-stream',
        'x-s3mini-replication-token': 'replication-token',
        'x-s3mini-bucket': bucket,
        'x-s3mini-key': 'replica.txt',
        'x-s3mini-version-id': 'replica-version+',
        'x-s3mini-operation': 'PutObject',
        'x-s3mini-etag': etag,
        'x-s3mini-last-modified': String(Date.now()),
      },
      payload: body,
    });
    expect(replicated.statusCode).toBe(204);
    expect((await s3.getObject(bucket, 'replica.txt', 'replica-version+')).data.toString()).toBe('replicated body');
    expect((await s3.listReplicationEvents()).some(event => event.key === 'replica.txt')).toBe(false);
    const inventory = await app.inject({
      method: 'GET',
      url: '/internal/replication/inventory',
      headers: { 'x-s3mini-replication-token': 'replication-token' },
    });
    expect(inventory.statusCode).toBe(200);
    expect(JSON.parse(inventory.body)).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'replica.txt', versionId: 'replica-version+', deleteMarker: false })]));
    const deleted = await app.inject({
      method: 'PUT',
      url: '/internal/replication',
      headers: {
        'content-type': 'application/octet-stream',
        'x-s3mini-replication-token': 'replication-token',
        'x-s3mini-bucket': bucket,
        'x-s3mini-key': 'replica.txt',
        'x-s3mini-version-id': 'replica-version+',
        'x-s3mini-operation': 'DeleteObject',
        'x-s3mini-delete-marker': 'false',
        'x-s3mini-last-modified': String(Date.now()),
      },
    });
    expect(deleted.statusCode).toBe(204);
    await expect(s3.getObject(bucket, 'replica.txt', 'replica-version+')).rejects.toMatchObject({ code: 'NoSuchKey' });
    delete process.env.S3MINI_REPLICATION_TOKEN;
  });
});
