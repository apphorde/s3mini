export type StorageClass = 'STANDARD' | 'ONEZONE_IA';

export const VALID_LOCATION_CONSTRAINTS: string[] = [
  'us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1',
  'eu-central-1', 'ap-southeast-1', 'ap-northeast-1', 'sa-east-1'
];

export interface Bucket {
  name: string;
  locationConstraint: string;
  creationDate: Date;
}

export interface ObjectMetadata {
  key: string;
  bucket: string;
  versionId: string;
  size: number;
  etag: string;
  contentType: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  expires?: Date;
  contentLanguage?: string;
  lastModified: Date;
  storageClass: StorageClass;
  ownerId: string;
  ownerDisplayName: string;
  userMetadata: Record<string, string>;
  serverSideEncryption?: 'AES256' | 'aws:kms';
  sseKmsKeyId?: string;
  objectLockMode?: 'GOVERNANCE' | 'COMPLIANCE';
  objectLockRetainUntilDate?: Date;
  objectLockLegalHold?: boolean;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface MultipartUpload {
  uploadId: string;
  bucket: string;
  key: string;
  initiator: string;
  initiatorDisplayName: string;
  storageClass?: StorageClass;
  serverSideEncryption?: 'AES256' | 'aws:kms';
  initiated: Date;
  parts: Map<number, UploadedPart>;
}

export interface Tag {
  Key: string;
  Value: string;
}

export interface CORSRule {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
  maxAgeSeconds?: number;
  exposeHeaders?: string[];
}

export interface BucketCorsConfiguration {
  corsRules: CORSRule[];
}

export class S3Error extends Error {
  constructor(
    public code: string,
    message: string,
    public httpCode: number = 400,
    public bucketName?: string,
    public keyName?: string,
  ) {
    super(message);
    this.name = 'S3Error';
  }

  toResponseXml(requestId: string): string {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Error>\n  <Code>${esc(this.code)}</Code>\n  <Message>${esc(this.message)}</Message>\n${this.bucketName ? `  <BucketName>${esc(this.bucketName)}</BucketName>\n` : ''}${this.keyName ? `  <KeyName>${esc(this.keyName)}</KeyName>\n` : ''}  <RequestId>${requestId}</RequestId>\n</Error>`;
  }
}

export interface ObjectSummary {
  Key: string;
  LastModified: Date;
  ETag: string;
  Size: number;
  StorageClass: StorageClass;
  Owner?: { ID: string; DisplayName: string };
}

export interface CommonPrefix {
  Prefix: string;
}

export interface ListObjectsV2Response {
  Name?: string;
  Prefix?: string;
  MaxKeys?: number;
  Delimiter?: string;
  IsTruncated: boolean;
  Contents?: ObjectSummary[];
  CommonPrefixes?: CommonPrefix[];
  ContinuationToken?: string;
  NextContinuationToken?: string;
  StartAfter?: string;
}

export interface VersioningConfiguration {
  Status: 'Enabled' | 'Suspended' | null;
}

export interface CreateObjectParams {
  body: Buffer;
  meta?: Record<string, string>;
  contentType?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  expires?: Date;
  storageClass?: StorageClass;
  userMetadata?: Record<string, string>;
}

export interface CopyResult {
  ETag: string;
  LastModified: Date;
  Source: string;
}

export function generateETag(body: Buffer): string {
  return '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
}

export function generateVersionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < 32; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r + '+';
}

export const DEFAULT_OWNER_ID = '000000000000000000000000';
export const COPY_SOURCE_MAX = 5 * 1024 * 1024;
import crypto from 'node:crypto';
