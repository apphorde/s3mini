import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { S3Mini } from '../storage/s3mini.js';
import { S3Error } from '../types/models.js';

describe('S3Mini', () => {
  let s3: S3Mini;
  const bucket = `test-${Date.now()}`;

  beforeEach(async () => {
    s3 = new S3Mini();
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

  it('persists access keys without exposing secrets in listings', async () => {
    const created = await s3.createAccessKey('test-admin');
    expect(created.accessKeyId).toMatch(/^s3mini-/);
    expect(created.secretAccessKey).toBeTruthy();
    expect((await s3.listAccessKeys()).find(key => key.accessKeyId === created.accessKeyId)).toMatchObject({ displayName: 'test-admin', status: 'Active' });
    expect(await s3.getAccessKey(created.accessKeyId)).toMatchObject({ secretAccessKey: created.secretAccessKey, status: 'Active' });
    await s3.setAccessKeyStatus(created.accessKeyId, 'Disabled');
    expect(await s3.getAccessKey(created.accessKeyId)).toMatchObject({ status: 'Disabled' });
    expect((await s3.listAccessKeys()).find(key => key.accessKeyId === created.accessKeyId)).not.toHaveProperty('secretAccessKey');
  });

  it('rejects invalid bucket names, locations, and traversal keys', async () => {
    await expect(s3.createBucket('Bad_Name')).rejects.toMatchObject({ code: 'InvalidBucketName' });
    await expect(s3.createBucket('valid-bucket', 'moon-1')).rejects.toMatchObject({ code: 'InvalidLocationConstraint' });
    await s3.createBucket(bucket);
    await expect(s3.putObject(bucket, '../outside', Buffer.from('x'), {})).rejects.toMatchObject({ code: 'InvalidObjectName' });
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

  it('records durable replication intent for object writes', async () => {
    await s3.createBucket(bucket);
    const object = await s3.putObject(bucket, 'replicated.txt', Buffer.from('replicate me'), {});
    const event = (await s3.listReplicationEvents()).find(item => item.bucket === bucket && item.key === 'replicated.txt' && item.versionId === object.versionId);
    expect(event).toMatchObject({ operation: 'PutObject', status: 'Pending', etag: object.etag, size: 12 });
    expect(event?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await s3.claimReplicationEvents('test-worker')).map(item => item.id)).toEqual([event!.id]);
    expect(await s3.claimReplicationEvents('other-worker')).toEqual([]);
    await s3.updateReplicationEvent(event!.id, 'Delivered', 1);
    expect((await s3.listReplicationEvents()).find(item => item.id === event!.id)?.status).toBe('Delivered');
  });

  it('rejects replicated bodies with an invalid SHA-256 digest', async () => {
    await s3.createBucket(bucket);
    await expect(s3.acceptReplicatedObject({
      bucket,
      key: 'invalid-sha.txt',
      versionId: 'remote-version+',
      etag: '"9dd4e461268c8034f5c8564e155c67a6"',
      sha256: 'bad',
      lastModified: Date.now(),
      body: Buffer.from('test'),
    })).rejects.toMatchObject({ code: 'BadDigest' });
  });

  it('persists replication peer health across storage restarts', async () => {
    await s3.savePeerHealth({ peer: 'http://vpn-peer:9000', status: 'Unhealthy', consecutiveFailures: 3, lastFailureAt: new Date(1700000000000) });
    await s3.close();
    s3 = new S3Mini();
    await s3.init();
    expect(await s3.listPeerHealth()).toEqual([expect.objectContaining({ peer: 'http://vpn-peer:9000', status: 'Unhealthy', consecutiveFailures: 3, lastFailureAt: new Date(1700000000000) })]);
  });

  it('moves exhausted replication events to a dead-letter state and allows retry', async () => {
    await s3.createBucket(bucket);
    const object = await s3.putObject(bucket, 'dead-letter.txt', Buffer.from('retry me'), {});
    const event = (await s3.listReplicationEvents()).find(item => item.key === 'dead-letter.txt');
    await s3.updateReplicationEvent(event!.id, 'DeadLetter', 8);
    expect((await s3.listReplicationEvents(100, 'DeadLetter')).find(item => item.id === event!.id)?.status).toBe('DeadLetter');
    await s3.retryReplicationEvent(event!.id);
    expect((await s3.listReplicationEvents()).find(item => item.id === event!.id)).toMatchObject({ status: 'Pending', attempts: 0 });
    expect(object.versionId).toBeTruthy();
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

  it('lists objects with delimiter and pagination', async () => {
    await s3.createBucket(bucket);
    await s3.putObject(bucket, 'a.txt', Buffer.from('a'), {});
    await s3.putObject(bucket, 'folder/b.txt', Buffer.from('b'), {});
    await s3.putObject(bucket, 'folder/c.txt', Buffer.from('c'), {});

    const first = await s3.listObjectsV2Advanced({ bucket, delimiter: '/', maxKeys: 1 });
    expect(first.contents.map(item => item.key)).toEqual(['a.txt']);
    expect(first.commonPrefixes).toEqual([]);
    expect(first.isTruncated).toBe(true);

    const second = await s3.listObjectsV2Advanced({ bucket, delimiter: '/', continuationToken: first.nextContinuationToken });
    expect(second.commonPrefixes).toEqual(['folder/']);
    expect(second.contents).toHaveLength(0);
  });

  it('creates, lists, completes, and aborts multipart uploads', async () => {
    await s3.createBucket(bucket);
    const upload = await s3.createMultipartUpload(bucket, 'large.bin');
    const first = await s3.uploadPart({ bucket, key: 'large.bin', uploadId: upload.uploadId, partNumber: 1, body: Buffer.from('hello ') });
    const second = await s3.uploadPart({ bucket, key: 'large.bin', uploadId: upload.uploadId, partNumber: 2, body: Buffer.from('world') });
    expect((await s3.listParts({ bucket, key: 'large.bin', uploadId: upload.uploadId })).parts).toHaveLength(2);

    const completed = await s3.completeMultipartUpload({
      bucket,
      key: 'large.bin',
      uploadId: upload.uploadId,
      parts: [{ partNumber: 1, etag: first.etag }, { partNumber: 2, etag: second.etag }],
    });
    expect(completed.etag).toBeTruthy();
    expect((await s3.getObject(bucket, 'large.bin')).data.toString()).toBe('hello world');

    const aborted = await s3.createMultipartUpload(bucket, 'aborted.bin');
    await s3.abortMultipartUpload(bucket, 'aborted.bin', aborted.uploadId);
    await expect(s3.listParts({ bucket, key: 'aborted.bin', uploadId: aborted.uploadId })).rejects.toMatchObject({ code: 'NoSuchUpload' });
  });

  it('persists versioning and object and bucket tags', async () => {
    await s3.createBucket(bucket);
    expect(await s3.getVersioning(bucket)).toEqual({});
    await s3.putVersioning(bucket, 'Enabled');
    expect(await s3.getVersioning(bucket)).toEqual({ status: 'Enabled' });

    const object = await s3.putObject(bucket, 'tagged.txt', Buffer.from('first'), {});
    const latest = await s3.putObject(bucket, 'tagged.txt', Buffer.from('second'), {});
    expect((await s3.getObject(bucket, 'tagged.txt')).data.toString()).toBe('second');
    expect((await s3.getObject(bucket, 'tagged.txt', object.versionId)).data.toString()).toBe('first');
    await s3.putObjectTags(bucket, 'tagged.txt', { environment: 'test' }, object.versionId);
    expect(await s3.getObjectTags(bucket, 'tagged.txt', object.versionId)).toEqual({ environment: 'test' });
    await s3.deleteObjectTags(bucket, 'tagged.txt', object.versionId);
    await expect(s3.getObjectTags(bucket, 'tagged.txt', object.versionId)).rejects.toMatchObject({ code: 'NoSuchTagSet' });

    await s3.putBucketTags(bucket, { team: 'storage' });
    expect(await s3.getBucketTags(bucket)).toEqual({ team: 'storage' });
    await s3.deleteBucketTags(bucket);
    expect(await s3.getBucketTags(bucket)).toEqual({});
    expect((await s3.listObjectVersions(bucket, 'tagged'))[0].VersionId).toBe(latest.versionId);
    await s3.deleteObjectVersion(bucket, 'tagged.txt', object.versionId);
  });

  it('persists bucket location and configuration documents', async () => {
    await s3.createBucket(bucket, 'eu-west-1');
    expect(await s3.getBucketLocation(bucket)).toBe('eu-west-1');
    await s3.putBucketConfiguration(bucket, 'corsConfiguration', { rules: [{ allowedOrigins: ['*'] }] });
    expect(await s3.getBucketConfiguration(bucket, 'corsConfiguration')).toEqual({ rules: [{ allowedOrigins: ['*'] }] });
    await s3.deleteBucketConfiguration(bucket, 'corsConfiguration');
    expect(await s3.getBucketConfiguration(bucket, 'corsConfiguration')).toBeUndefined();
  });

  it('creates delete markers when versioning is enabled', async () => {
    await s3.createBucket(bucket);
    await s3.putVersioning(bucket, 'Enabled');
    await s3.putObject(bucket, 'marker.txt', Buffer.from('data'), {});
    await s3.deleteObject(bucket, 'marker.txt');
    await expect(s3.getObject(bucket, 'marker.txt')).rejects.toMatchObject({ code: 'NoSuchKey' });
    expect((await s3.listObjectVersions(bucket, 'marker'))[0].IsDeleteMarker).toBe(true);
  });

  it('applies enabled lifecycle expiration rules during reads', async () => {
    await s3.createBucket(bucket);
    await s3.putBucketConfiguration(bucket, 'lifecycleConfiguration', {
      rules: [{ status: 'Enabled', filter: { prefix: 'tmp/' }, expiration: { days: 0 } }],
    });
    await s3.putObject(bucket, 'tmp/expired.txt', Buffer.from('expired'), {});
    await s3.putObject(bucket, 'keep.txt', Buffer.from('keep'), {});
    expect((await s3.listObjectsV2Advanced({ bucket })).contents.map(item => item.key)).toEqual(['keep.txt']);
  });

  it('transitions current and noncurrent versions and expires old versions', async () => {
    await s3.createBucket(bucket);
    await s3.putVersioning(bucket, 'Enabled');
    const first = await s3.putObject(bucket, 'archive.txt', Buffer.from('first'), {});
    await s3.putObject(bucket, 'archive.txt', Buffer.from('second'), {});
    await s3.putBucketConfiguration(bucket, 'lifecycleConfiguration', {
      rules: [{
        status: 'Enabled',
        filter: { prefix: 'archive' },
        noncurrentVersionTransitions: [{ noncurrentDays: 0, storageClass: 'GLACIER' }],
        noncurrentVersionExpiration: { noncurrentDays: 0 },
      }],
    });

    await s3.getObject(bucket, 'archive.txt');
    await expect(s3.getObject(bucket, 'archive.txt', first.versionId)).rejects.toMatchObject({ code: 'NoSuchKey' });
    expect((await s3.listObjectVersions(bucket, 'archive.txt')).some(version => version.VersionId === first.versionId)).toBe(false);
  });

  it('applies current-version lifecycle transitions', async () => {
    await s3.createBucket(bucket);
    await s3.putObject(bucket, 'cold.txt', Buffer.from('cold'), {});
    await s3.putBucketConfiguration(bucket, 'lifecycleConfiguration', {
      rules: [{ status: 'Enabled', prefix: 'cold', transitions: [{ days: 0, storageClass: 'GLACIER' }] }],
    });

    await s3.getObject(bucket, 'cold.txt');
    expect((await s3.getObject(bucket, 'cold.txt')).metadata.storageClass).toBe('GLACIER');
  });

  it('copies objects and serves byte ranges', async () => {
    await s3.createBucket(bucket);
    await s3.putObject(bucket, 'source.txt', Buffer.from('abcdef'), { contentType: 'text/plain' });
    const copied = await s3.copyObject(bucket, 'source.txt', bucket, 'copy.txt');
    expect(copied.contentType).toBe('text/plain');
    const ranged = await s3.getObjectRange(bucket, 'copy.txt', 1, 3);
    expect(ranged.data.toString()).toBe('bcd');
    expect(ranged.totalSize).toBe(6);
  });
});
