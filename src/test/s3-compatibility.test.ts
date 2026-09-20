import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

const configuredTargets = [
  {
    name: 'MinIO',
    endpoint: process.env.S3MINI_MINIO_ENDPOINT,
    accessKeyId: process.env.S3MINI_MINIO_ACCESS_KEY,
    secretAccessKey: process.env.S3MINI_MINIO_SECRET_KEY,
  },
  {
    name: 'Backblaze B2',
    endpoint: process.env.S3MINI_B2_ENDPOINT,
    accessKeyId: process.env.S3MINI_B2_ACCESS_KEY,
    secretAccessKey: process.env.S3MINI_B2_SECRET_KEY,
  },
];
const targets = configuredTargets.filter((target): target is typeof target & { endpoint: string; accessKeyId: string; secretAccessKey: string } => Boolean(target.endpoint && target.accessKeyId && target.secretAccessKey));

describe.skipIf(!targets.length)('S3-compatible provider interoperability', () => {
  for (const target of targets) {
    it(`${target.name} supports core CRUD, metadata, deletion, and multipart`, async () => {
      const client = new S3Client({
        endpoint: target.endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey },
      });
      const bucket = `s3mini-compat-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: 'compat.txt', Body: 'compatibility', ContentType: 'text/plain', Metadata: { client: target.name } }));
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: 'compat.txt' }));
        expect(head.ContentType).toBe('text/plain');
        expect(head.Metadata?.client).toBe(target.name);
        expect(await (await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'compat.txt' }))).Body?.transformToString()).toBe('compatibility');

        const upload = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: 'multipart.bin' }));
        const part = await client.send(new UploadPartCommand({ Bucket: bucket, Key: 'multipart.bin', UploadId: upload.UploadId, PartNumber: 1, Body: 'multipart' }));
        await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: 'multipart.bin', UploadId: upload.UploadId, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] } }));
        await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: [{ Key: 'compat.txt' }, { Key: 'multipart.bin' }] } }));
      } finally {
        await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
        client.destroy();
      }
    });
  }
});
