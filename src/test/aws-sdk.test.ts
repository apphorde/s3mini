import {
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'sdk.txt', Body: 'hello SDK', ContentType: 'text/plain' }));

    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(listed.Contents?.map(object => object.Key)).toEqual(['sdk.txt']);
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'sdk.txt' }));
    expect(await object.Body?.transformToString()).toBe('hello SDK');

    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'sdk.txt' }));
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
});
