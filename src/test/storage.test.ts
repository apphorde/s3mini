import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeS3 } from '../storage/fakes3.js';
import { S3Error } from '../types/models.js';

describe('FakeS3', () => {
  let s3: FakeS3;
  const bucket = `test-${Date.now()}`;

  beforeEach(async () => {
    s3 = new FakeS3();
    await s3.init();
  });

  afterEach(async () => {
    await s3.clearBucket(bucket);
    await s3.close();
  });

  it('creates and lists a bucket', async () => {
    await s3.createBucket(bucket, 'eu-west-1');
    const result = await s3.listBuckets();
    expect(result.find((item) => item.name === bucket)?.locationConstraint).toBe('eu-west-1');
  });

  it('rejects duplicate buckets', async () => {
    await s3.createBucket(bucket);
    await expect(s3.createBucket(bucket)).rejects.toMatchObject({ code: 'BucketAlreadyExists' });
  });

  it('stores, reads, lists, and deletes an object', async () => {
    await s3.createBucket(bucket);
    const body = Buffer.from('hello');
    const metadata = await s3.putObject(bucket, 'folder/item.txt', body, { contentType: 'text/plain' });

    expect(metadata.size).toBe(body.length);
    expect(metadata.contentType).toBe('text/plain');
    const object = await s3.getObject(bucket, 'folder/item.txt');
    expect(object.data.equals(body)).toBe(true);
    expect((await s3.listObjectsV2(bucket, 'folder/'))[0].Key).toBe('folder/item.txt');

    await s3.deleteObject(bucket, 'folder/item.txt');
    await expect(s3.getObject(bucket, 'folder/item.txt')).rejects.toMatchObject({ code: 'NoSuchKey' });
  });

  it('does not delete a non-empty bucket', async () => {
    await s3.createBucket(bucket);
    await s3.putObject(bucket, 'item', Buffer.from('data'), {});
    await expect(s3.deleteBucket(bucket)).rejects.toMatchObject({ code: 'BucketNotEmpty' });
  });

  it('reports missing buckets and objects as S3 errors', async () => {
    await expect(s3.headBucket('missing-bucket')).rejects.toBeInstanceOf(S3Error);
    await s3.createBucket(bucket);
    await expect(s3.deleteObject(bucket, 'missing')).rejects.toMatchObject({ code: 'NoSuchKey' });
  });
});
