import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import type { Bucket, ObjectMetadata, ObjectSummary } from '../types/models.js';
import { S3Error } from '../types/models.js';
import { VALID_LOCATION_CONSTRAINTS } from '../types/models.js';
import type {
  CompleteMultipartUploadRequest,
  CompleteMultipartUploadResult,
  CreateMultipartUploadResult,
  ListObjectsV2Request,
  ListObjectsV2Result,
  ListPartsRequest,
  ListPartsResult,
  ListMultipartUploadsRequest,
  ListMultipartUploadsResult,
  MultipartPart,
  ObjectSummary as ContractObjectSummary,
  PutObjectRequest,
  UploadPartRequest,
} from '../types/contracts.js';

export const STORAGE_BASE = '/data/objects';

export class FakeS3 {
  private db: any;
  private initialized = false;

  constructor() {}

  private versionPath(bucket: string, key: string, versionId: string): string {
    return path.join(STORAGE_BASE, bucket, '.versions', versionId, key);
  }

  private validateKey(key: string): void {
    if (!key || path.isAbsolute(key) || key.split('/').some(part => part === '..')) {
      throw new S3Error('InvalidObjectName', 'The object key is invalid.', 400, undefined, key);
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(STORAGE_BASE, { recursive: true });
    const dbPath = path.join(STORAGE_BASE, 'meta.db');
    
    this.db = await new Promise<any>((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.run(`CREATE TABLE IF NOT EXISTS buckets (
      name TEXT PRIMARY KEY,
      locationConstraint TEXT DEFAULT 'us-east-1',
      creationDate INTEGER
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS objs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      etag TEXT,
      contentType TEXT,
      contentDisposition TEXT,
      contentEncoding TEXT,
      cacheControl TEXT,
      expires INTEGER,
      lastModified INTEGER,
      size INTEGER,
      storageClass TEXT DEFAULT 'STANDARD',
      versionId TEXT,
      ownerId TEXT DEFAULT '000000000000000000000000',
      ownerDisplayName TEXT DEFAULT 's3mini',
      UNIQUE(bucket, key, versionId)
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(bucket, key, name)
    )`);
    for (const column of ['encryption TEXT', 'sseKmsKeyId TEXT', 'objectLockMode TEXT', 'retainUntil INTEGER', 'legalHold TEXT']) {
      try { await this.run(`ALTER TABLE objs ADD COLUMN ${column}`); } catch { /* Existing databases already have the column. */ }
    }
    await this.run(`CREATE TABLE IF NOT EXISTS multipart_uploads (
      uploadId TEXT PRIMARY KEY,
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      initiated INTEGER NOT NULL,
      storageClass TEXT NOT NULL DEFAULT 'STANDARD'
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS multipart_parts (
      uploadId TEXT NOT NULL,
      partNumber INTEGER NOT NULL,
      etag TEXT NOT NULL,
      size INTEGER NOT NULL,
      lastModified INTEGER NOT NULL,
      body BLOB NOT NULL,
      PRIMARY KEY(uploadId, partNumber)
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS bucket_settings (
      bucket TEXT PRIMARY KEY,
      versioningStatus TEXT,
      bucketTags TEXT,
      corsConfiguration TEXT,
      lifecycleConfiguration TEXT,
      policy TEXT,
      encryptionConfiguration TEXT,
      websiteConfiguration TEXT,
      loggingStatus TEXT,
      notificationConfiguration TEXT,
      replicationConfiguration TEXT
      ,acl TEXT
    )`);
    try { await this.run('ALTER TABLE bucket_settings ADD COLUMN acl TEXT'); } catch { /* Existing databases already have the column. */ }
    await this.run(`CREATE TABLE IF NOT EXISTS object_tags (
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      versionId TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL,
      PRIMARY KEY(bucket, key, versionId)
    )`);
    this.initialized = true;
  }

  private run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err: any) => (err ? reject(err) : resolve()));
    });
  }

  private get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err: any, row: any) => (err ? reject(err) : resolve(row)));
    });
  }

  private all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err: any, rows: any[]) => (err ? reject(err) : resolve(rows)));
    });
  }

  async listBuckets(): Promise<Bucket[]> {
    const rows = await this.all('SELECT * FROM buckets');
    return rows.map((r: any) => ({
      name: r.name,
      locationConstraint: r.locationConstraint,
      creationDate: new Date(r.creationDate),
    }));
  }

  async createBucket(name: string, locationConstraint: string = 'us-east-1'): Promise<void> {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) || name.includes('..') || name.includes('.-') || name.includes('-.')) {
      throw new S3Error('InvalidBucketName', 'The bucket name is invalid.', 400, name);
    }
    if (!VALID_LOCATION_CONSTRAINTS.includes(locationConstraint)) {
      throw new S3Error('InvalidLocationConstraint', 'The location constraint is invalid.', 400, name);
    }
    const exists = await this.get('SELECT name FROM buckets WHERE name = ?', [name]);
    if (exists) throw new S3Error('BucketAlreadyExists', 'Bucket already exists.', 409, name);
    await this.run('INSERT INTO buckets (name, locationConstraint, creationDate) VALUES (?, ?, ?)', [name, locationConstraint, Date.now()]);
    await this.run('INSERT INTO bucket_settings (bucket, versioningStatus) VALUES (?, ?)', [name, null]);
    await fs.mkdir(path.join(STORAGE_BASE, name), { recursive: true });
  }

  async headBucket(name: string): Promise<void> {
    const bucket = await this.get('SELECT name FROM buckets WHERE name = ?', [name]);
    if (!bucket) throw new S3Error('NoSuchBucket', 'Bucket not found', 404, name);
  }

  async deleteBucket(name: string): Promise<void> {
    const bucket = await this.get('SELECT name FROM buckets WHERE name = ?', [name]);
    if (!bucket) throw new S3Error('NoSuchBucket', 'Bucket not found', 404, name);
    const object = await this.get('SELECT id FROM objs WHERE bucket = ? LIMIT 1', [name]);
    if (object) throw new S3Error('BucketNotEmpty', 'The bucket you tried to delete is not empty.', 409, name);
    await this.run('DELETE FROM objs WHERE bucket = ?', [name]);
    await this.run('DELETE FROM tags WHERE bucket = ?', [name]);
    await this.run('DELETE FROM object_tags WHERE bucket = ?', [name]);
    await this.run('DELETE FROM bucket_settings WHERE bucket = ?', [name]);
    await this.run('DELETE FROM buckets WHERE name = ?', [name]);
    await fs.rm(path.join(STORAGE_BASE, name), { recursive: true, force: true });
  }

  async close(): Promise<void> {
    if (!this.db) return;
    await new Promise<void>((resolve, reject) => {
      this.db.close((error: Error | null) => error ? reject(error) : resolve());
    });
    this.db = undefined;
    this.initialized = false;
  }

  async clearBucket(name: string): Promise<void> {
    await this.run('DELETE FROM objs WHERE bucket = ?', [name]);
    await this.run('DELETE FROM tags WHERE bucket = ?', [name]);
    await this.run('DELETE FROM object_tags WHERE bucket = ?', [name]);
    await this.run('DELETE FROM bucket_settings WHERE bucket = ?', [name]);
    await this.run('DELETE FROM buckets WHERE name = ?', [name]);
    await fs.rm(path.join(STORAGE_BASE, name), { recursive: true, force: true });
  }

  async putObject(bucketName: string, key: string, body: Buffer, meta: any): Promise<ObjectMetadata> {
    this.validateKey(key);
    const b = await this.get('SELECT name FROM buckets WHERE name = ?', [bucketName]);
    if (!b) throw new S3Error('NoSuchBucket', 'Bucket not found', 404, bucketName);

    const versionId = crypto.randomBytes(8).toString('hex') + '+';
    const etag = '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
    const lastModified = Date.now();
    const filePath = path.join(STORAGE_BASE, bucketName, key);
    const versionFilePath = this.versionPath(bucketName, key, versionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.mkdir(path.dirname(versionFilePath), { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.writeFile(versionFilePath, body);

    await this.run(`
      INSERT INTO objs (bucket, key, etag, contentType, contentDisposition, contentEncoding, cacheControl, expires, lastModified, size, storageClass, versionId, ownerId, ownerDisplayName, encryption, sseKmsKeyId, objectLockMode, retainUntil, legalHold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bucketName, key, etag, meta.contentType || null, meta.contentDisposition || null,
        meta.contentEncoding || null, meta.cacheControl || null, 
        meta.expires ? new Date(meta.expires).getTime() : null,
        lastModified, body.length, meta.storageClass || 'STANDARD', versionId, '000000000000000000000000', 's3mini', meta.serverSideEncryption || null, meta.sseKmsKeyId || null, meta.objectLockMode || null, meta.retainUntil ? new Date(meta.retainUntil).getTime() : null, meta.legalHold || null
      ]
    );

    return {
      key, bucket: bucketName, versionId, etag, contentType: meta.contentType || 'application/octet-stream',
      contentDisposition: meta.contentDisposition, contentEncoding: meta.contentEncoding,
      cacheControl: meta.cacheControl, expires: meta.expires ? new Date(meta.expires) : undefined,
      lastModified: new Date(lastModified), storageClass: meta.storageClass || 'STANDARD',
      ownerId: '000000000000000000000000', ownerDisplayName: 's3mini',
      userMetadata: meta.userMetadata || {},
      serverSideEncryption: meta.serverSideEncryption,
      sseKmsKeyId: meta.sseKmsKeyId,
      objectLockMode: meta.objectLockMode,
      objectLockRetainUntilDate: meta.retainUntil ? new Date(meta.retainUntil) : undefined,
      objectLockLegalHold: meta.legalHold === 'ON',
      size: body.length // FIX: added missing size
    };
  }

  async getObject(bucketName: string, key: string, versionId?: string): Promise<{ data: Buffer, metadata: ObjectMetadata }> {
    this.validateKey(key);
    const row = versionId
      ? await this.get('SELECT * FROM objs WHERE bucket = ? AND key = ? AND versionId = ?', [bucketName, key, versionId])
      : await this.get('SELECT * FROM objs WHERE bucket = ? AND key = ? ORDER BY id DESC LIMIT 1', [bucketName, key]);
    if (!row) throw new S3Error('NoSuchKey', 'Object not found', 404, bucketName, key);

    const versionFilePath = this.versionPath(bucketName, key, row.versionId);
    const filePath = await fs.stat(versionFilePath).then(() => versionFilePath).catch(() => path.join(STORAGE_BASE, bucketName, key));
    const data = await fs.readFile(filePath);

    const metadata: ObjectMetadata = {
      key: row.key, bucket: row.bucket, versionId: row.versionId, size: row.size, etag: row.etag,
      contentType: row.contentType || 'application/octet-stream', contentDisposition: row.contentDisposition || undefined,
      contentEncoding: row.contentEncoding || undefined, cacheControl: row.cacheControl || undefined,
      expires: row.expires ? new Date(row.expires) : undefined, lastModified: new Date(row.lastModified),
      storageClass: row.storageClass, ownerId: row.ownerId, ownerDisplayName: row.ownerDisplayName,
      userMetadata: {}, serverSideEncryption: row.encryption || undefined, sseKmsKeyId: row.sseKmsKeyId || undefined,
      objectLockMode: row.objectLockMode || undefined, objectLockRetainUntilDate: row.retainUntil ? new Date(row.retainUntil) : undefined, objectLockLegalHold: row.legalHold === 'ON'
    };
    return { data, metadata };
  }

  async getObjectRange(bucketName: string, key: string, start: number, end?: number): Promise<{ data: Buffer, metadata: ObjectMetadata, totalSize: number }> {
    const object = await this.getObject(bucketName, key);
    if (start < 0 || start >= object.data.length || (end !== undefined && end < start)) {
      throw new S3Error('InvalidRange', 'The requested range is not satisfiable.', 416, bucketName, key);
    }
    return {
      data: object.data.subarray(start, end === undefined ? undefined : end + 1),
      metadata: object.metadata,
      totalSize: object.data.length,
    };
  }

  async copyObject(sourceBucket: string, sourceKey: string, destinationBucket: string, destinationKey: string): Promise<ObjectMetadata> {
    const source = await this.getObject(sourceBucket, sourceKey);
    return this.putObject(destinationBucket, destinationKey, source.data, {
      contentType: source.metadata.contentType,
      contentDisposition: source.metadata.contentDisposition,
      contentEncoding: source.metadata.contentEncoding,
      cacheControl: source.metadata.cacheControl,
      expires: source.metadata.expires,
      storageClass: source.metadata.storageClass,
    });
  }

  async deleteObject(bucketName: string, key: string): Promise<void> {
    this.validateKey(key);
    const found = await this.get('SELECT id, objectLockMode, retainUntil, legalHold FROM objs WHERE bucket = ? AND key = ?', [bucketName, key]);
    if (!found) throw new S3Error('NoSuchKey', 'Object not found', 404, bucketName, key);
    if (found.legalHold === 'ON' || (found.retainUntil && found.retainUntil > Date.now())) throw new S3Error('AccessDenied', 'Object retention prevents deletion.', 403, bucketName, key);
    await this.run('DELETE FROM objs WHERE bucket = ? AND key = ?', [bucketName, key]);
    await this.run('DELETE FROM tags WHERE bucket = ? AND key = ?', [bucketName, key]);
    await this.run('DELETE FROM object_tags WHERE bucket = ? AND key = ?', [bucketName, key]);
    await fs.rm(path.join(STORAGE_BASE, bucketName, key), { force: true });
    await fs.rm(path.join(STORAGE_BASE, bucketName, '.versions'), { recursive: true, force: true });
  }

  async getVersioning(bucket: string): Promise<{ status?: 'Enabled' | 'Suspended' }> {
    await this.headBucket(bucket);
    const row = await this.get('SELECT versioningStatus FROM bucket_settings WHERE bucket = ?', [bucket]);
    return row?.versioningStatus ? { status: row.versioningStatus } : {};
  }

  async putVersioning(bucket: string, status: 'Enabled' | 'Suspended'): Promise<void> {
    await this.headBucket(bucket);
    await this.run('UPDATE bucket_settings SET versioningStatus = ? WHERE bucket = ?', [status, bucket]);
  }

  async listObjectVersions(bucket: string, prefix?: string): Promise<any[]> {
    await this.headBucket(bucket);
    const rows = await this.all('SELECT * FROM objs WHERE bucket = ? ORDER BY key ASC, id DESC', [bucket]);
    return (rows as any[])
      .filter(row => !prefix || row.key.startsWith(prefix))
      .map((row, index, all) => ({
        Key: row.key,
        VersionId: row.versionId,
        IsLatest: index === all.findIndex(candidate => candidate.key === row.key),
        LastModified: new Date(row.lastModified),
        ETag: row.etag,
        Size: row.size,
        StorageClass: row.storageClass,
        Owner: { ID: row.ownerId, DisplayName: row.ownerDisplayName },
      }));
  }

  async deleteObjectVersion(bucket: string, key: string, versionId: string): Promise<void> {
    this.validateKey(key);
    await this.headBucket(bucket);
    const row = await this.get('SELECT id FROM objs WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, key, versionId]);
    if (!row) throw new S3Error('NoSuchVersion', 'The specified version does not exist.', 404, bucket, key);
    await this.run('DELETE FROM objs WHERE id = ?', [row.id]);
    await this.run('DELETE FROM object_tags WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, key, versionId]);
    await fs.rm(this.versionPath(bucket, key, versionId), { force: true });
  }

  async putObjectTags(bucket: string, key: string, tags: Record<string, string>, versionId = ''): Promise<void> {
    await this.headBucket(bucket);
    const object = await this.get('SELECT id FROM objs WHERE bucket = ? AND key = ? AND (? = \'\' OR versionId = ?) LIMIT 1', [bucket, key, versionId, versionId]);
    if (!object) throw new S3Error(versionId ? 'NoSuchVersion' : 'NoSuchKey', 'Object not found', 404, bucket, key);
    await this.run('INSERT OR REPLACE INTO object_tags (bucket, key, versionId, tags) VALUES (?, ?, ?, ?)', [bucket, key, versionId, JSON.stringify(tags)]);
  }

  async getObjectTags(bucket: string, key: string, versionId = ''): Promise<Record<string, string>> {
    await this.headBucket(bucket);
    const row = await this.get('SELECT tags FROM object_tags WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, key, versionId]);
    if (!row) throw new S3Error('NoSuchTagSet', 'The object has no tags.', 404, bucket, key);
    return JSON.parse(row.tags) as Record<string, string>;
  }

  async deleteObjectTags(bucket: string, key: string, versionId = ''): Promise<void> {
    await this.headBucket(bucket);
    await this.run('DELETE FROM object_tags WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, key, versionId]);
  }

  async putBucketTags(bucket: string, tags: Record<string, string>): Promise<void> {
    await this.headBucket(bucket);
    await this.run('UPDATE bucket_settings SET bucketTags = ? WHERE bucket = ?', [JSON.stringify(tags), bucket]);
  }

  async getBucketTags(bucket: string): Promise<Record<string, string>> {
    await this.headBucket(bucket);
    const row = await this.get('SELECT bucketTags FROM bucket_settings WHERE bucket = ?', [bucket]);
    return row?.bucketTags ? JSON.parse(row.bucketTags) : {};
  }

  async deleteBucketTags(bucket: string): Promise<void> {
    await this.headBucket(bucket);
    await this.run('UPDATE bucket_settings SET bucketTags = NULL WHERE bucket = ?', [bucket]);
  }

  async getBucketLocation(bucket: string): Promise<string> {
    const row = await this.get('SELECT locationConstraint FROM buckets WHERE name = ?', [bucket]);
    if (!row) throw new S3Error('NoSuchBucket', 'Bucket not found', 404, bucket);
    return row.locationConstraint;
  }

  async putBucketConfiguration(bucket: string, name: 'corsConfiguration' | 'lifecycleConfiguration' | 'policy' | 'encryptionConfiguration' | 'websiteConfiguration' | 'loggingStatus' | 'notificationConfiguration' | 'replicationConfiguration' | 'acl', value: unknown): Promise<void> {
    await this.headBucket(bucket);
    await this.run(`UPDATE bucket_settings SET ${name} = ? WHERE bucket = ?`, [JSON.stringify(value), bucket]);
  }

  async getBucketConfiguration<T>(bucket: string, name: 'corsConfiguration' | 'lifecycleConfiguration' | 'policy' | 'encryptionConfiguration' | 'websiteConfiguration' | 'loggingStatus' | 'notificationConfiguration' | 'replicationConfiguration' | 'acl'): Promise<T | undefined> {
    await this.headBucket(bucket);
    const row = await this.get(`SELECT ${name} FROM bucket_settings WHERE bucket = ?`, [bucket]);
    return row?.[name] ? JSON.parse(row[name]) as T : undefined;
  }

  async deleteBucketConfiguration(bucket: string, name: 'corsConfiguration' | 'lifecycleConfiguration' | 'policy' | 'encryptionConfiguration' | 'websiteConfiguration' | 'loggingStatus' | 'notificationConfiguration' | 'replicationConfiguration' | 'acl'): Promise<void> {
    await this.headBucket(bucket);
    await this.run(`UPDATE bucket_settings SET ${name} = NULL WHERE bucket = ?`, [bucket]);
  }

  async listObjectsV2(bucketName: string, prefix?: string): Promise<any[]> {
    const rows = await this.all('SELECT * FROM objs WHERE bucket = ?', [bucketName]);
    const filtered = rows.filter((r: any) => !prefix || r.key.startsWith(prefix));
    return filtered.map((r: any) => ({
      Key: r.key, LastModified: new Date(r.lastModified), ETag: r.etag,
      Size: r.size, StorageClass: r.storageClass, Owner: { ID: r.ownerId, DisplayName: r.ownerDisplayName }
    }));
  }

  async listObjectsV2Advanced(request: ListObjectsV2Request): Promise<ListObjectsV2Result> {
    await this.headBucket(request.bucket);
    const rows = await this.all('SELECT * FROM objs WHERE bucket = ? ORDER BY key ASC', [request.bucket]);
    const prefix = request.prefix || '';
    const delimiter = request.delimiter;
    const marker = request.continuationToken
      ? Buffer.from(request.continuationToken, 'base64url').toString('utf8')
      : request.startAfter;
    const entries = new Map<string, ContractObjectSummary | string>();

    for (const row of rows as any[]) {
      if (!row.key.startsWith(prefix) || (marker && row.key <= marker)) continue;
      if (delimiter) {
        const remainder = row.key.slice(prefix.length);
        const delimiterIndex = remainder.indexOf(delimiter);
        if (delimiterIndex >= 0) {
          const commonPrefix = prefix + remainder.slice(0, delimiterIndex + delimiter.length);
          entries.set(commonPrefix, commonPrefix);
          continue;
        }
      }
      entries.set(row.key, {
        key: row.key,
        etag: row.etag,
        size: row.size,
        lastModified: new Date(row.lastModified),
        storageClass: row.storageClass,
        owner: { id: row.ownerId, displayName: row.ownerDisplayName },
      });
    }

    const ordered = [...entries.entries()].sort(([left], [right]) => left.localeCompare(right));
    const maxKeys = Math.max(0, Math.min(request.maxKeys ?? 1000, 1000));
    const page = ordered.slice(0, maxKeys);
    const isTruncated = ordered.length > page.length;
    const lastEntry = page[page.length - 1]?.[0];
    const result: ListObjectsV2Result = {
      name: request.bucket,
      prefix: request.prefix,
      delimiter: request.delimiter,
      maxKeys,
      keyCount: page.length,
      isTruncated,
      contents: page.flatMap(([, value]) => typeof value === 'string' ? [] : [value]),
      commonPrefixes: page.flatMap(([, value]) => typeof value === 'string' ? [value] : []),
      startAfter: request.startAfter,
    };
    if (request.continuationToken) result.continuationToken = request.continuationToken;
    if (isTruncated && lastEntry) result.nextContinuationToken = Buffer.from(lastEntry).toString('base64url');
    return result;
  }

  async createMultipartUpload(bucket: string, key: string, storageClass = 'STANDARD'): Promise<CreateMultipartUploadResult> {
    await this.headBucket(bucket);
    const uploadId = crypto.randomUUID();
    await this.run('INSERT INTO multipart_uploads (uploadId, bucket, key, initiated, storageClass) VALUES (?, ?, ?, ?, ?)', [uploadId, bucket, key, Date.now(), storageClass]);
    return { uploadId, bucket, key };
  }

  async uploadPart(request: UploadPartRequest): Promise<MultipartPart> {
    const upload = await this.get('SELECT uploadId FROM multipart_uploads WHERE uploadId = ? AND bucket = ? AND key = ?', [request.uploadId, request.bucket, request.key]);
    if (!upload) throw new S3Error('NoSuchUpload', 'The specified multipart upload does not exist.', 404, request.bucket, request.key);
    if (request.partNumber < 1 || request.partNumber > 10000) throw new S3Error('InvalidPart', 'Part number must be between 1 and 10000.', 400, request.bucket, request.key);
    const etag = '"' + crypto.createHash('md5').update(request.body).digest('hex') + '"';
    const lastModified = Date.now();
    await this.run('INSERT OR REPLACE INTO multipart_parts (uploadId, partNumber, etag, size, lastModified, body) VALUES (?, ?, ?, ?, ?, ?)', [request.uploadId, request.partNumber, etag, request.body.length, lastModified, request.body]);
    return { partNumber: request.partNumber, etag, size: request.body.length, lastModified: new Date(lastModified) };
  }

  async listParts(request: ListPartsRequest): Promise<ListPartsResult> {
    const upload = await this.get('SELECT uploadId FROM multipart_uploads WHERE uploadId = ? AND bucket = ? AND key = ?', [request.uploadId, request.bucket, request.key]);
    if (!upload) throw new S3Error('NoSuchUpload', 'The specified multipart upload does not exist.', 404, request.bucket, request.key);
    const rows = await this.all('SELECT * FROM multipart_parts WHERE uploadId = ? AND partNumber > ? ORDER BY partNumber ASC', [request.uploadId, request.partNumberMarker || 0]);
    const maxParts = Math.max(0, Math.min(request.maxParts ?? 1000, 1000));
    const page = rows.slice(0, maxParts) as any[];
    return {
      bucket: request.bucket,
      key: request.key,
      uploadId: request.uploadId,
      parts: page.map(row => ({ partNumber: row.partNumber, etag: row.etag, size: row.size, lastModified: new Date(row.lastModified) })),
      isTruncated: rows.length > page.length,
      nextPartNumberMarker: rows.length > page.length ? page[page.length - 1].partNumber : undefined,
    };
  }

  async completeMultipartUpload(request: CompleteMultipartUploadRequest): Promise<CompleteMultipartUploadResult> {
    const upload = await this.get('SELECT * FROM multipart_uploads WHERE uploadId = ? AND bucket = ? AND key = ?', [request.uploadId, request.bucket, request.key]);
    if (!upload) throw new S3Error('NoSuchUpload', 'The specified multipart upload does not exist.', 404, request.bucket, request.key);
    if (!request.parts.length) throw new S3Error('InvalidRequest', 'At least one part is required.', 400, request.bucket, request.key);
    const bodies: Buffer[] = [];
    for (const part of request.parts) {
      const row = await this.get('SELECT body, etag FROM multipart_parts WHERE uploadId = ? AND partNumber = ?', [request.uploadId, part.partNumber]);
      if (!row || row.etag !== part.etag) throw new S3Error('InvalidPart', 'One or more requested parts could not be found.', 400, request.bucket, request.key);
      bodies.push(row.body);
    }
    const result = await this.putObject(request.bucket, request.key, Buffer.concat(bodies), {});
    await this.run('DELETE FROM multipart_parts WHERE uploadId = ?', [request.uploadId]);
    await this.run('DELETE FROM multipart_uploads WHERE uploadId = ?', [request.uploadId]);
    return { bucket: request.bucket, key: request.key, etag: result.etag, versionId: result.versionId };
  }

  async abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void> {
    const upload = await this.get('SELECT uploadId FROM multipart_uploads WHERE uploadId = ? AND bucket = ? AND key = ?', [uploadId, bucket, key]);
    if (!upload) throw new S3Error('NoSuchUpload', 'The specified multipart upload does not exist.', 404, bucket, key);
    await this.run('DELETE FROM multipart_parts WHERE uploadId = ?', [uploadId]);
    await this.run('DELETE FROM multipart_uploads WHERE uploadId = ?', [uploadId]);
  }

  async listMultipartUploads(request: ListMultipartUploadsRequest): Promise<ListMultipartUploadsResult> {
    await this.headBucket(request.bucket);
    const rows = await this.all('SELECT * FROM multipart_uploads WHERE bucket = ? ORDER BY key, initiated', [request.bucket]);
    const filtered = (rows as any[]).filter(row => !request.prefix || row.key.startsWith(request.prefix));
    return {
      bucket: request.bucket,
      uploads: filtered.slice(0, request.maxUploads ?? 1000).map(row => ({
        uploadId: row.uploadId,
        bucket: row.bucket,
        key: row.key,
        initiated: new Date(row.initiated),
        initiator: { id: '000000000000000000000000', displayName: 's3mini' },
        owner: { id: '000000000000000000000000', displayName: 's3mini' },
        storageClass: row.storageClass,
        parts: [],
      })),
      commonPrefixes: [],
      isTruncated: filtered.length > (request.maxUploads ?? 1000),
    };
  }
}
