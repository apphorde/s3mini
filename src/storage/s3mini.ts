import { DatabaseSync } from 'node:sqlite';
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
export const DATABASE_PATH = '/data/s3mini.sqlite';
export const NODE_ID = process.env.S3MINI_NODE_ID || 'node-local';

export interface AccessKeyRecord {
  accessKeyId: string;
  displayName: string;
  status: 'Active' | 'Disabled';
  createdAt: Date;
  lastUsedAt?: Date;
}

export interface ReplicationEvent {
  id: number;
  bucket: string;
  key: string;
  versionId: string;
  operation: 'PutObject' | 'DeleteObject';
  sourceNodeId: string;
  payloadPath: string;
  etag: string;
  size: number;
  deleteMarker: boolean;
  status: 'Pending' | 'Delivered' | 'Failed';
  attempts: number;
  nextAttemptAt?: Date;
  createdAt: Date;
}

export interface ReplicatedObject {
  bucket: string;
  key: string;
  versionId: string;
  etag: string;
  lastModified: number;
  body: Buffer;
}

export class S3Mini {
  private db?: DatabaseSync;
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
    try {
      await fs.access(DATABASE_PATH);
    } catch {
      try { await fs.copyFile(path.join(STORAGE_BASE, 'meta.db'), DATABASE_PATH); } catch { /* Start with a new database. */ }
    }
    this.db = new DatabaseSync(DATABASE_PATH);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL');

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
       contentLanguage TEXT,
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
    for (const column of ['contentLanguage TEXT', 'encryption TEXT', 'sseKmsKeyId TEXT', 'objectLockMode TEXT', 'retainUntil INTEGER', 'legalHold TEXT', 'deleteMarker INTEGER', 'userMetadata TEXT']) {
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
    await this.run(`CREATE TABLE IF NOT EXISTS object_acl (
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      versionId TEXT NOT NULL DEFAULT '',
      acl TEXT NOT NULL,
      PRIMARY KEY(bucket, key, versionId)
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS access_keys (
      accessKeyId TEXT PRIMARY KEY,
      secretAccessKey TEXT NOT NULL,
      displayName TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      createdAt INTEGER NOT NULL,
      lastUsedAt INTEGER
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS replication_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      versionId TEXT NOT NULL,
      operation TEXT NOT NULL,
      sourceNodeId TEXT NOT NULL,
      payloadPath TEXT NOT NULL,
      etag TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt INTEGER,
      deleteMarker INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      UNIQUE(bucket, key, versionId, operation, sourceNodeId)
    )`);
    try { await this.run('ALTER TABLE replication_events ADD COLUMN deleteMarker INTEGER NOT NULL DEFAULT 0'); } catch { /* Existing databases already have the column. */ }
    this.initialized = true;
  }

  private async run(sql: string, params: any[] = []): Promise<void> {
    this.db?.prepare(sql).run(...params);
  }

  private async get(sql: string, params: any[] = []): Promise<any> {
    return this.db?.prepare(sql).get(...params);
  }

  private async all(sql: string, params: any[] = []): Promise<any[]> {
    return (this.db?.prepare(sql).all(...params) || []) as any[];
  }

  async listBuckets(): Promise<Bucket[]> {
    const rows = await this.all('SELECT * FROM buckets');
    return rows.map((r: any) => ({
      name: r.name,
      locationConstraint: r.locationConstraint,
      creationDate: new Date(r.creationDate),
    }));
  }

  async applyLifecycle(bucket: string): Promise<void> {
    const configuration = await this.getBucketConfiguration<{ rules?: Array<any> }>(bucket, 'lifecycleConfiguration');
    if (!configuration?.rules?.length) return;
    const rows = await this.all('SELECT * FROM objs WHERE bucket = ?', [bucket]);
    const now = Date.now();
    const versioning = await this.getVersioning(bucket);
    const rowsByKey = new Map<string, any[]>();
    for (const row of rows as any[]) {
      const versions = rowsByKey.get(row.key) || [];
      versions.push(row);
      rowsByKey.set(row.key, versions);
    }

    for (const [key, versions] of rowsByKey) {
      versions.sort((left, right) => right.id - left.id);
      for (const [index, row] of versions.entries()) {
        const noncurrent = index > 0;
        const rule = configuration.rules.find(candidate => lifecycleRuleMatches(candidate, row.key));
        if (!rule) continue;

        const transition = lifecycleTransition(rule, noncurrent, row.lastModified, now);
        if (transition && row.storageClass !== transition) {
          await this.run('UPDATE objs SET storageClass = ? WHERE id = ?', [transition, row.id]);
        }

        const expiration = noncurrent ? rule.noncurrentVersionExpiration : rule.expiration;
        if (!expiration || !lifecycleAgeReached(expiration, row.lastModified, now)) continue;
        if (row.deleteMarker && !expiration.expiredObjectDeleteMarker) continue;
        if (noncurrent || !versioning.status || row.deleteMarker) {
          await this.removeObjectVersion(bucket, row, !noncurrent && !versioning.status);
          continue;
        }

        // Versioned lifecycle expiration hides the current version with a marker.
        await this.run('INSERT INTO objs (bucket, key, etag, lastModified, size, storageClass, versionId, ownerId, ownerDisplayName, deleteMarker) VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?, 1)', [bucket, key, now, 'STANDARD', crypto.randomBytes(8).toString('hex') + '+', '000000000000000000000000', 's3mini']);
        await fs.rm(path.join(STORAGE_BASE, bucket, key), { force: true });
      }
    }
  }

  private async removeObjectVersion(bucket: string, row: any, removeCurrentFile = false): Promise<void> {
    await this.run('DELETE FROM objs WHERE id = ?', [row.id]);
    await this.run('DELETE FROM object_tags WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, row.key, row.versionId]);
    await this.run('DELETE FROM object_acl WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, row.key, row.versionId]);
    await fs.rm(this.versionPath(bucket, row.key, row.versionId), { force: true });
    if (row.deleteMarker || removeCurrentFile) await fs.rm(path.join(STORAGE_BASE, bucket, row.key), { force: true });
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
    await this.run('DELETE FROM object_acl WHERE bucket = ?', [name]);
    await this.run('DELETE FROM replication_events WHERE bucket = ?', [name]);
    await this.run('DELETE FROM bucket_settings WHERE bucket = ?', [name]);
    await this.run('DELETE FROM buckets WHERE name = ?', [name]);
    await fs.rm(path.join(STORAGE_BASE, name), { recursive: true, force: true });
  }

  async close(): Promise<void> {
    if (!this.db) return;
    this.db.close();
    this.db = undefined;
    this.initialized = false;
  }

  async createAccessKey(displayName = ''): Promise<{ accessKeyId: string; secretAccessKey: string }> {
    const accessKeyId = `s3mini-${crypto.randomBytes(12).toString('base64url')}`;
    const secretAccessKey = crypto.randomBytes(32).toString('base64url');
    await this.run('INSERT INTO access_keys (accessKeyId, secretAccessKey, displayName, status, createdAt) VALUES (?, ?, ?, ?, ?)', [accessKeyId, secretAccessKey, displayName, 'Active', Date.now()]);
    return { accessKeyId, secretAccessKey };
  }

  async listAccessKeys(): Promise<AccessKeyRecord[]> {
    const rows = await this.all('SELECT accessKeyId, displayName, status, createdAt, lastUsedAt FROM access_keys ORDER BY createdAt DESC');
    return rows.map(row => ({
      accessKeyId: row.accessKeyId,
      displayName: row.displayName,
      status: row.status,
      createdAt: new Date(row.createdAt),
      lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : undefined,
    }));
  }

  async getAccessKey(accessKeyId: string): Promise<{ accessKeyId: string; secretAccessKey: string; status: 'Active' | 'Disabled' } | undefined> {
    const row = await this.get('SELECT accessKeyId, secretAccessKey, status FROM access_keys WHERE accessKeyId = ?', [accessKeyId]);
    return row ? { accessKeyId: row.accessKeyId, secretAccessKey: row.secretAccessKey, status: row.status } : undefined;
  }

  async setAccessKeyStatus(accessKeyId: string, status: 'Active' | 'Disabled'): Promise<void> {
    await this.run('UPDATE access_keys SET status = ? WHERE accessKeyId = ?', [status, accessKeyId]);
  }

  async markAccessKeyUsed(accessKeyId: string): Promise<void> {
    await this.run('UPDATE access_keys SET lastUsedAt = ? WHERE accessKeyId = ?', [Date.now(), accessKeyId]);
  }

  async hasActiveAccessKeys(): Promise<boolean> {
    return Boolean(await this.get("SELECT 1 FROM access_keys WHERE status = 'Active' LIMIT 1"));
  }

  async listReplicationEvents(limit = 100): Promise<ReplicationEvent[]> {
    const rows = await this.all('SELECT * FROM replication_events ORDER BY id ASC LIMIT ?', [Math.max(1, Math.min(limit, 1000))]);
    return rows.map(row => ({
      id: row.id,
      bucket: row.bucket,
      key: row.key,
      versionId: row.versionId,
      operation: row.operation,
      sourceNodeId: row.sourceNodeId,
      payloadPath: row.payloadPath,
      etag: row.etag,
      size: row.size,
      deleteMarker: Boolean(row.deleteMarker),
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt) : undefined,
      createdAt: new Date(row.createdAt),
    }));
  }

  async updateReplicationEvent(id: number, status: 'Pending' | 'Delivered' | 'Failed', attempts: number, nextAttemptAt?: Date): Promise<void> {
    await this.run('UPDATE replication_events SET status = ?, attempts = ?, nextAttemptAt = ? WHERE id = ?', [status, attempts, nextAttemptAt?.getTime() || null, id]);
  }

  private async queueReplicationEvent(event: Omit<ReplicationEvent, 'id' | 'status' | 'attempts' | 'nextAttemptAt'>): Promise<void> {
    await this.run('INSERT OR IGNORE INTO replication_events (bucket, key, versionId, operation, sourceNodeId, payloadPath, etag, size, deleteMarker, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [event.bucket, event.key, event.versionId, event.operation, event.sourceNodeId, event.payloadPath, event.etag, event.size, event.deleteMarker ? 1 : 0, event.createdAt.getTime()]);
  }

  async readReplicationPayload(event: ReplicationEvent): Promise<Buffer> {
    return fs.readFile(event.payloadPath);
  }

  async acceptReplicatedObject(object: ReplicatedObject): Promise<void> {
    this.validateKey(object.key);
    if (!/^[A-Za-z0-9._+-]+$/.test(object.versionId)) throw new S3Error('InvalidRequest', 'The replicated version ID is invalid.', 400, object.bucket, object.key);
    if ('"' + crypto.createHash('md5').update(object.body).digest('hex') + '"' !== object.etag) throw new S3Error('BadDigest', 'The replicated object ETag did not match its body.', 400, object.bucket, object.key);
    if (!(await this.get('SELECT name FROM buckets WHERE name = ?', [object.bucket]))) throw new S3Error('NoSuchBucket', 'Bucket not found', 404, object.bucket);
    if (await this.get('SELECT id FROM objs WHERE bucket = ? AND key = ? AND versionId = ?', [object.bucket, object.key, object.versionId])) return;

    const filePath = path.join(STORAGE_BASE, object.bucket, object.key);
    const versionFilePath = this.versionPath(object.bucket, object.key, object.versionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.mkdir(path.dirname(versionFilePath), { recursive: true });
    await writeDurableFile(versionFilePath, object.body);
    const current = await this.get('SELECT lastModified FROM objs WHERE bucket = ? AND key = ? ORDER BY lastModified DESC, id DESC LIMIT 1', [object.bucket, object.key]);
    if (!current || object.lastModified >= current.lastModified) await writeDurableFile(filePath, object.body);

    this.db?.exec('BEGIN IMMEDIATE');
    try {
      await this.run('INSERT INTO objs (bucket, key, etag, contentType, lastModified, size, storageClass, versionId, ownerId, ownerDisplayName, deleteMarker, userMetadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [object.bucket, object.key, object.etag, 'application/octet-stream', object.lastModified, object.body.length, 'STANDARD', object.versionId, '000000000000000000000000', 's3mini', 0, '{}']);
      this.db?.exec('COMMIT');
    } catch (error) {
      this.db?.exec('ROLLBACK');
      await fs.rm(versionFilePath, { force: true });
      throw error;
    }
  }

  async acceptReplicatedDelete(event: { bucket: string; key: string; versionId: string; lastModified: number; deleteMarker: boolean }): Promise<void> {
    this.validateKey(event.key);
    if (!(await this.get('SELECT name FROM buckets WHERE name = ?', [event.bucket]))) throw new S3Error('NoSuchBucket', 'Bucket not found', 404, event.bucket);
    if (event.deleteMarker) {
      if (await this.get('SELECT id FROM objs WHERE bucket = ? AND key = ? AND versionId = ?', [event.bucket, event.key, event.versionId])) return;
      await this.run('INSERT INTO objs (bucket, key, etag, lastModified, size, storageClass, versionId, ownerId, ownerDisplayName, deleteMarker, userMetadata) VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?, 1, ?)', [event.bucket, event.key, event.lastModified, 'STANDARD', event.versionId, '000000000000000000000000', 's3mini', '{}']);
      await fs.rm(path.join(STORAGE_BASE, event.bucket, event.key), { force: true });
      return;
    }
    if (event.versionId) {
      const row = await this.get('SELECT id FROM objs WHERE bucket = ? AND key = ? AND versionId = ?', [event.bucket, event.key, event.versionId]);
      if (row) await this.deleteReplicatedVersion(event.bucket, event.key, event.versionId, row.id);
      return;
    }
    await this.run('DELETE FROM objs WHERE bucket = ? AND key = ?', [event.bucket, event.key]);
    await fs.rm(path.join(STORAGE_BASE, event.bucket, event.key), { force: true });
  }

  private async deleteReplicatedVersion(bucket: string, key: string, versionId: string, id: number): Promise<void> {
    await this.run('DELETE FROM objs WHERE id = ?', [id]);
    await this.run('DELETE FROM object_tags WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, key, versionId]);
    await fs.rm(this.versionPath(bucket, key, versionId), { force: true });
  }

  async clearBucket(name: string): Promise<void> {
    await this.run('DELETE FROM objs WHERE bucket = ?', [name]);
    await this.run('DELETE FROM tags WHERE bucket = ?', [name]);
    await this.run('DELETE FROM object_tags WHERE bucket = ?', [name]);
    await this.run('DELETE FROM object_acl WHERE bucket = ?', [name]);
    await this.run('DELETE FROM replication_events WHERE bucket = ?', [name]);
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
    await writeDurableFile(filePath, body);
    await writeDurableFile(versionFilePath, body);

    this.db?.exec('BEGIN IMMEDIATE');
    try {
      await this.run(`
       INSERT INTO objs (bucket, key, etag, contentType, contentLanguage, contentDisposition, contentEncoding, cacheControl, expires, lastModified, size, storageClass, versionId, ownerId, ownerDisplayName, encryption, sseKmsKeyId, objectLockMode, retainUntil, legalHold, deleteMarker, userMetadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
         bucketName, key, etag, meta.contentType || null, meta.contentLanguage || null, meta.contentDisposition || null,
         meta.contentEncoding || null, meta.cacheControl || null,
         meta.expires ? new Date(meta.expires).getTime() : null,
         lastModified, body.length, meta.storageClass || 'STANDARD', versionId, '000000000000000000000000', 's3mini', meta.serverSideEncryption || null, meta.sseKmsKeyId || null, meta.objectLockMode || null, meta.retainUntil ? new Date(meta.retainUntil).getTime() : null, meta.legalHold || null, 0, JSON.stringify(meta.userMetadata || {})
        ]
      );
      await this.queueReplicationEvent({ bucket: bucketName, key, versionId, operation: 'PutObject', sourceNodeId: NODE_ID, payloadPath: versionFilePath, etag, size: body.length, deleteMarker: false, createdAt: new Date(lastModified) });
      this.db?.exec('COMMIT');
    } catch (error) {
      this.db?.exec('ROLLBACK');
      await fs.rm(filePath, { force: true });
      await fs.rm(versionFilePath, { force: true });
      throw error;
    }

    return {
       key, bucket: bucketName, versionId, etag, contentType: meta.contentType || 'application/octet-stream', contentLanguage: meta.contentLanguage,
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
    await this.applyLifecycle(bucketName);
    const row = versionId
      ? await this.get('SELECT * FROM objs WHERE bucket = ? AND key = ? AND versionId = ?', [bucketName, key, versionId])
       : await this.get('SELECT * FROM objs WHERE bucket = ? AND key = ? ORDER BY lastModified DESC, id DESC LIMIT 1', [bucketName, key]);
    if (!row) throw new S3Error('NoSuchKey', 'Object not found', 404, bucketName, key);
    if (row.deleteMarker) throw new S3Error('NoSuchKey', 'The object is deleted.', 404, bucketName, key);

    const versionFilePath = this.versionPath(bucketName, key, row.versionId);
    const filePath = await fs.stat(versionFilePath).then(() => versionFilePath).catch(() => path.join(STORAGE_BASE, bucketName, key));
    const data = await fs.readFile(filePath);

    const metadata: ObjectMetadata = {
       key: row.key, bucket: row.bucket, versionId: row.versionId, size: row.size, etag: row.etag,
       contentType: row.contentType || 'application/octet-stream', contentLanguage: row.contentLanguage || undefined, contentDisposition: row.contentDisposition || undefined,
      contentEncoding: row.contentEncoding || undefined, cacheControl: row.cacheControl || undefined,
      expires: row.expires ? new Date(row.expires) : undefined, lastModified: new Date(row.lastModified),
      storageClass: row.storageClass, ownerId: row.ownerId, ownerDisplayName: row.ownerDisplayName,
      userMetadata: row.userMetadata ? JSON.parse(row.userMetadata) : {}, serverSideEncryption: row.encryption || undefined, sseKmsKeyId: row.sseKmsKeyId || undefined,
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
      contentLanguage: source.metadata.contentLanguage,
      contentDisposition: source.metadata.contentDisposition,
      contentEncoding: source.metadata.contentEncoding,
      cacheControl: source.metadata.cacheControl,
      expires: source.metadata.expires,
      storageClass: source.metadata.storageClass,
      userMetadata: source.metadata.userMetadata,
      serverSideEncryption: source.metadata.serverSideEncryption,
      sseKmsKeyId: source.metadata.sseKmsKeyId,
    });
  }

  async restoreObject(bucket: string, key: string): Promise<void> {
    await this.headBucket(bucket);
    await this.getObject(bucket, key);
  }

  async selectObjectContent(bucket: string, key: string, expression: string): Promise<Buffer> {
    if (!/^\s*SELECT\s+\*\s+FROM\s+S3Object\s*;?\s*$/i.test(expression)) {
      throw new S3Error('InvalidExpression', 'Only SELECT * FROM S3Object is supported.', 400, bucket, key);
    }
    return (await this.getObject(bucket, key)).data;
  }

  async deleteObject(bucketName: string, key: string): Promise<void> {
    this.validateKey(key);
    const found = await this.get('SELECT id, objectLockMode, retainUntil, legalHold FROM objs WHERE bucket = ? AND key = ?', [bucketName, key]);
    if (!found) throw new S3Error('NoSuchKey', 'Object not found', 404, bucketName, key);
    if (found.legalHold === 'ON' || (found.retainUntil && found.retainUntil > Date.now())) throw new S3Error('AccessDenied', 'Object retention prevents deletion.', 403, bucketName, key);
    const versioning = await this.getVersioning(bucketName);
    if (versioning.status === 'Enabled') {
      const markerId = crypto.randomBytes(8).toString('hex') + '+';
      const deletedAt = Date.now();
      await this.run('INSERT INTO objs (bucket, key, etag, lastModified, size, storageClass, versionId, ownerId, ownerDisplayName, deleteMarker) VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?, 1)', [bucketName, key, deletedAt, 'STANDARD', markerId, '000000000000000000000000', 's3mini']);
      await this.queueReplicationEvent({ bucket: bucketName, key, versionId: markerId, operation: 'DeleteObject', sourceNodeId: NODE_ID, payloadPath: '', etag: '', size: 0, deleteMarker: true, createdAt: new Date(deletedAt) });
      await fs.rm(path.join(STORAGE_BASE, bucketName, key), { force: true });
      return;
    }
    await this.run('DELETE FROM objs WHERE bucket = ? AND key = ?', [bucketName, key]);
    await this.run('DELETE FROM tags WHERE bucket = ? AND key = ?', [bucketName, key]);
    await this.run('DELETE FROM object_tags WHERE bucket = ? AND key = ?', [bucketName, key]);
    await this.run('DELETE FROM object_acl WHERE bucket = ? AND key = ?', [bucketName, key]);
    await fs.rm(path.join(STORAGE_BASE, bucketName, key), { force: true });
    await fs.rm(path.join(STORAGE_BASE, bucketName, '.versions'), { recursive: true, force: true });
    await this.queueReplicationEvent({ bucket: bucketName, key, versionId: '', operation: 'DeleteObject', sourceNodeId: NODE_ID, payloadPath: '', etag: '', size: 0, deleteMarker: false, createdAt: new Date() });
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; code: string }> }> {
    await this.headBucket(bucket);
    const deleted: string[] = [];
    const errors: Array<{ key: string; code: string }> = [];
    for (const key of keys) {
      try {
        await this.deleteObject(bucket, key);
        deleted.push(key);
      } catch (error) {
        if (error instanceof S3Error && error.code === 'NoSuchKey') deleted.push(key);
        else errors.push({ key, code: error instanceof S3Error ? error.code : 'InternalError' });
      }
    }
    return { deleted, errors };
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
        IsDeleteMarker: Boolean(row.deleteMarker),
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
    await this.queueReplicationEvent({ bucket, key, versionId, operation: 'DeleteObject', sourceNodeId: NODE_ID, payloadPath: '', etag: '', size: 0, deleteMarker: false, createdAt: new Date() });
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

  async putObjectAcl(bucket: string, key: string, acl: unknown, versionId = ''): Promise<void> {
    await this.headBucket(bucket);
    await this.getObject(bucket, key, versionId || undefined);
    await this.run('INSERT OR REPLACE INTO object_acl (bucket, key, versionId, acl) VALUES (?, ?, ?, ?)', [bucket, key, versionId, JSON.stringify(acl)]);
  }

  async getObjectAcl<T>(bucket: string, key: string, versionId = ''): Promise<T> {
    await this.headBucket(bucket);
    await this.getObject(bucket, key, versionId || undefined);
    const row = await this.get('SELECT acl FROM object_acl WHERE bucket = ? AND key = ? AND versionId = ?', [bucket, key, versionId]);
    return (row ? JSON.parse(row.acl) : { CannedACL: 'private' }) as T;
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

  async isRequestDenied(bucket: string, key: string | undefined, action: string, principal = '*', context: Record<string, string | undefined> = {}): Promise<boolean> {
    const policy = await this.getBucketConfiguration<{ statements?: Array<any> }>(bucket, 'policy');
    if (!policy?.statements) return false;
    const resource = `arn:aws:s3:::${bucket}${key ? `/${key}` : ''}`;
    const matching = policy.statements.filter(statement => policyStatementMatches(statement, resource, action, principal, context));
    if (matching.some(statement => statement.effect === 'Deny')) return true;
    return matching.some(statement => statement.effect === 'Allow') ? false : policy.statements.some(statement => statement.effect === 'Allow');
  }

  async isObjectRequestDenied(bucket: string, key: string, action: string, principal: string): Promise<boolean> {
    const acl = await this.getObjectAcl<{ CannedACL?: string }>(bucket, key).catch(() => ({ CannedACL: 'private' }));
    if (principal !== 'anonymous') return false;
    const requiredPermission = action === 'GetObject' ? 'READ' : action === 'GetObjectAcl' ? 'READ_ACP' : action === 'PutObjectAcl' ? 'WRITE_ACP' : 'WRITE';
    if (acl.CannedACL) {
      if (acl.CannedACL === 'public-read') return requiredPermission === 'READ';
      if (acl.CannedACL === 'public-read-write') return requiredPermission === 'READ' || requiredPermission === 'WRITE';
      if (acl.CannedACL === 'authenticated-read') return !(principal !== 'anonymous' && requiredPermission === 'READ');
      return true;
    }
    const grants = Array.isArray((acl as any).Grants) ? (acl as any).Grants : [];
    return !grants.some((grant: any) => {
      const grantee = grant.Grantee || {};
      const matches = grantee.ID === principal || (principal === 'anonymous' && grantee.URI === 'http://acs.amazonaws.com/groups/global/AllUsers') || (principal !== 'anonymous' && grantee.URI === 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers');
      return matches && grant.Permission === requiredPermission;
    });
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
    await this.applyLifecycle(request.bucket);
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
      encodingType: request.encodingType,
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

  async uploadPartCopy(bucket: string, key: string, uploadId: string, partNumber: number, sourceBucket: string, sourceKey: string): Promise<MultipartPart> {
    const source = await this.getObject(sourceBucket, sourceKey);
    return this.uploadPart({ bucket, key, uploadId, partNumber, body: source.data });
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

async function writeDurableFile(filePath: string, body: Buffer): Promise<void> {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporaryPath, 'w');
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function lifecycleRuleMatches(rule: any, key: string): boolean {
  if (rule.status && rule.status !== 'Enabled') return false;
  const prefix = rule.filter?.prefix ?? rule.prefix ?? '';
  return !prefix || key.startsWith(prefix);
}

function lifecycleAgeReached(condition: any, lastModified: number, now: number): boolean {
  if (condition.date !== undefined) return now >= Date.parse(String(condition.date));
  const days = condition.days ?? condition.noncurrentDays;
  if (days !== undefined) return now >= lastModified + Number(days) * 86_400_000;
  return false;
}

function lifecycleTransition(rule: any, noncurrent: boolean, lastModified: number, now: number): string | undefined {
  const transitions = noncurrent ? rule.noncurrentVersionTransitions : rule.transitions;
  if (!Array.isArray(transitions)) return undefined;
  return transitions
    .filter(transition => lifecycleAgeReached(transition, lastModified, now))
    .sort((left, right) => Number(right.days ?? right.noncurrentDays ?? 0) - Number(left.days ?? left.noncurrentDays ?? 0))
    .map(transition => transition.storageClass || transition.StorageClass)
    .find(Boolean);
}

function policyStatementMatches(statement: any, resource: string, action: string, principal: string, context: Record<string, string | undefined>): boolean {
  const actions = Array.isArray(statement.action) ? statement.action : [statement.action];
  const resources = Array.isArray(statement.resource) ? statement.resource : [statement.resource];
  const principals = statement.principal === '*' || statement.principal?.aws === '*' || [statement.principal, statement.principal?.aws].includes(principal);
  const actionMatches = actions.some((value: unknown) => typeof value === 'string' && wildcardMatches(value, action));
  const resourceMatches = resources.some((value: unknown) => typeof value === 'string' && wildcardMatches(value, resource));
  if (!principals || !actionMatches || !resourceMatches) return false;
  return policyConditionsMatch(statement.condition, context);
}

function policyConditionsMatch(condition: any, context: Record<string, string | undefined>): boolean {
  if (!condition) return true;
  for (const [operator, entries] of Object.entries(condition as Record<string, any>)) {
    for (const [name, expectedValue] of Object.entries(entries || {})) {
      const actual = context[name];
      const expected = Array.isArray(expectedValue) ? expectedValue.map(String) : [String(expectedValue)];
      const matches = operator === 'StringLike'
        ? expected.some(value => actual !== undefined && wildcardMatches(value, actual))
        : expected.includes(actual || '');
      if (operator === 'StringNotEquals' ? expected.includes(actual || '') : !matches) return false;
    }
  }
  return true;
}

function wildcardMatches(pattern: string, value: string): boolean {
  const expression = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(expression).test(value);
}
