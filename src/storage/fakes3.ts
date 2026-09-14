import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import type { Bucket, ObjectMetadata, ObjectSummary } from '../types/models.js';
import { S3Error } from '../types/models.js';

export const STORAGE_BASE = '/data/objects';

export class FakeS3 {
  private db: any;
  private initialized = false;

  constructor() {}

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
    const exists = await this.get('SELECT name FROM buckets WHERE name = ?', [name]);
    if (exists) throw new S3Error('BucketAlreadyExists', 'Bucket already exists.', 409, name);
    await this.run('INSERT INTO buckets (name, locationConstraint, creationDate) VALUES (?, ?, ?)', [name, locationConstraint, Date.now()]);
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
    await this.run('DELETE FROM buckets WHERE name = ?', [name]);
    await fs.rm(path.join(STORAGE_BASE, name), { recursive: true, force: true });
  }

  async putObject(bucketName: string, key: string, body: Buffer, meta: any): Promise<ObjectMetadata> {
    const b = await this.get('SELECT name FROM buckets WHERE name = ?', [bucketName]);
    if (!b) throw new S3Error('NoSuchBucket', 'Bucket not found', 404, bucketName);

    const versionId = crypto.randomBytes(8).toString('hex') + '+';
    const etag = '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
    const lastModified = Date.now();
    const filePath = path.join(STORAGE_BASE, bucketName, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);

    await this.run(`
      INSERT INTO objs (bucket, key, etag, contentType, contentDisposition, contentEncoding, cacheControl, expires, lastModified, size, storageClass, versionId, ownerId, ownerDisplayName)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bucketName, key, etag, meta.contentType || null, meta.contentDisposition || null,
        meta.contentEncoding || null, meta.cacheControl || null, 
        meta.expires ? new Date(meta.expires).getTime() : null,
        lastModified, body.length, meta.storageClass || 'STANDARD', versionId, '000000000000000000000000', 's3mini'
      ]
    );

    return {
      key, bucket: bucketName, versionId, etag, contentType: meta.contentType || 'application/octet-stream',
      contentDisposition: meta.contentDisposition, contentEncoding: meta.contentEncoding,
      cacheControl: meta.cacheControl, expires: meta.expires ? new Date(meta.expires) : undefined,
      lastModified: new Date(lastModified), storageClass: meta.storageClass || 'STANDARD',
      ownerId: '000000000000000000000000', ownerDisplayName: 's3mini',
      userMetadata: meta.userMetadata || {},
      size: body.length // FIX: added missing size
    };
  }

  async getObject(bucketName: string, key: string): Promise<{ data: Buffer, metadata: ObjectMetadata }> {
    const row = await this.get('SELECT * FROM objs WHERE bucket = ? AND key = ?', [bucketName, key]);
    if (!row) throw new S3Error('NoSuchKey', 'Object not found', 404, bucketName, key);

    const filePath = path.join(STORAGE_BASE, bucketName, key);
    const data = await fs.readFile(filePath);

    const metadata: ObjectMetadata = {
      key: row.key, bucket: row.bucket, versionId: row.versionId, size: row.size, etag: row.etag,
      contentType: row.contentType || 'application/octet-stream', contentDisposition: row.contentDisposition || undefined,
      contentEncoding: row.contentEncoding || undefined, cacheControl: row.cacheControl || undefined,
      expires: row.expires ? new Date(row.expires) : undefined, lastModified: new Date(row.lastModified),
      storageClass: row.storageClass, ownerId: row.ownerId, ownerDisplayName: row.ownerDisplayName,
      userMetadata: {}
    };
    return { data, metadata };
  }

  async deleteObject(bucketName: string, key: string): Promise<void> {
    const found = await this.get('SELECT id FROM objs WHERE bucket = ? AND key = ?', [bucketName, key]);
    if (!found) throw new S3Error('NoSuchKey', 'Object not found', 404, bucketName, key);
    await this.run('DELETE FROM objs WHERE bucket = ? AND key = ?', [bucketName, key]);
    await this.run('DELETE FROM tags WHERE bucket = ? AND key = ?', [bucketName, key]);
    await fs.rm(path.join(STORAGE_BASE, bucketName, key), { force: true });
  }

  async listObjectsV2(bucketName: string, prefix?: string): Promise<any[]> {
    const rows = await this.all('SELECT * FROM objs WHERE bucket = ?', [bucketName]);
    const filtered = rows.filter((r: any) => !prefix || r.key.startsWith(prefix));
    return filtered.map((r: any) => ({
      Key: r.key, LastModified: new Date(r.lastModified), ETag: r.etag,
      Size: r.size, StorageClass: r.storageClass, Owner: { ID: r.ownerId, DisplayName: r.ownerDisplayName }
    }));
  }
}
