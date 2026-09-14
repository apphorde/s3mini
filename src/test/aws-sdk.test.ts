import {
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteBucketTaggingCommand,
  DeleteObjectTaggingCommand,
  GetObjectCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetObjectTaggingCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutObjectTaggingCommand,
  UploadPartCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerRoutes } from '../handlers/router.js';
import { FakeS3 } from '../storage/fakes3.js';

describe('AWS SDK v3 compatibility', () => {
  let app: ReturnType<typeof Fastify>;
  let s3: FakeS3;
  let client: S3Client;
  let bucket: string;

  beforeEach(async () => {
    process.env.S3MINI_ACCESS_KEY = 's3mini';
    process.env.S3MINI_SECRET_KEY = 's3mini-secret';
    bucket = `sdk-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    s3 = new FakeS3();
    await s3.init();
    app = Fastify();
    await registerRoutes(app, s3);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    client = new S3Client({
      endpoint: address,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 's3mini', secretAccessKey: 's3mini-secret' },
    });
  });

  afterEach(async () => {
    delete process.env.S3MINI_ACCESS_KEY;
    delete process.env.S3MINI_SECRET_KEY;
    client.destroy();
    await app.close();
    await s3.clearBucket(bucket);
    await s3.close();
  });

  it('supports SDK bucket and object CRUD', async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'sdk.txt', Body: 'hello SDK', ContentType: 'text/plain', Metadata: { color: 'blue' }, CacheControl: 'max-age=60' }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'a.txt', Body: 'a' }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'b.txt', Body: 'b' }));

    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(listed.Contents?.map(object => object.Key)).toEqual(['a.txt', 'b.txt', 'sdk.txt']);
    const firstPage = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    expect(firstPage.IsTruncated).toBe(true);
    expect(firstPage.NextContinuationToken).toBeTruthy();
    const secondPage = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1, ContinuationToken: firstPage.NextContinuationToken }));
    expect(secondPage.Contents?.map(object => object.Key)).toEqual(['b.txt']);
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'sdk.txt' }));
    expect(await object.Body?.transformToString()).toBe('hello SDK');
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: 'sdk.txt' }));
    expect(head.ContentType).toBe('text/plain');
    expect(head.CacheControl).toBe('max-age=60');
    expect(head.Metadata).toEqual({ color: 'blue' });
    await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'sdk.txt', IfMatch: head.ETag }));
    const ranged = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'sdk.txt', Range: 'bytes=1-3' }));
    expect(await ranged.Body?.transformToString()).toBe('ell');
    const checksumBody = 'checksum SDK';
    const checksum = crypto.createHash('sha256').update(checksumBody).digest('base64');
    const checksumPut = await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'checksum.txt', Body: checksumBody, ChecksumSHA256: checksum }));
    expect(checksumPut.ChecksumSHA256).toBe(checksum);
    const copied = await client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/sdk.txt`, Key: 'copied.txt' }));
    expect(copied.CopyObjectResult?.ETag).toBeTruthy();
    const copiedObject = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'copied.txt' }));
    expect(await copiedObject.Body?.transformToString()).toBe('hello SDK');
    const copiedHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: 'copied.txt' }));
    expect(copiedHead.Metadata).toEqual({ color: 'blue' });

    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'sdk.txt' }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'a.txt' }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'b.txt' }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'copied.txt' }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'checksum.txt' }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'already-missing.txt' }));
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  });

  it('supports SDK multipart upload commands', async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    const initiated = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: 'multipart.txt' }));
    expect(initiated.UploadId).toBeTruthy();
    const part = await client.send(new UploadPartCommand({ Bucket: bucket, Key: 'multipart.txt', UploadId: initiated.UploadId, PartNumber: 1, Body: 'multipart SDK' }));
    expect(part.ETag).toBeTruthy();
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: 'multipart.txt',
      UploadId: initiated.UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] },
    }));
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'multipart.txt' }));
    expect(await object.Body?.transformToString()).toBe('multipart SDK');
  });

  it('supports SDK tagging and versioning commands', async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await client.send(new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet: [{ Key: 'team', Value: 'storage' }] } }));
    expect((await client.send(new GetBucketTaggingCommand({ Bucket: bucket }))).TagSet).toEqual([{ Key: 'team', Value: 'storage' }]);
    await client.send(new DeleteBucketTaggingCommand({ Bucket: bucket }));
    await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    expect((await client.send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status).toBe('Enabled');
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'tagged.txt', Body: 'tagged' }));
    await client.send(new PutObjectTaggingCommand({ Bucket: bucket, Key: 'tagged.txt', Tagging: { TagSet: [{ Key: 'kind', Value: 'test' }] } }));
    expect((await client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: 'tagged.txt' }))).TagSet).toEqual([{ Key: 'kind', Value: 'test' }]);
    await client.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: 'tagged.txt' }));
  });
});
