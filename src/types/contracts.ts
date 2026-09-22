// Type contracts for the S3-compatible API. This module intentionally contains
// no runtime values, classes, or implementation helpers.

export type StorageClass =
  | 'STANDARD'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'INTELLIGENT_TIERING'
  | 'GLACIER'
  | 'DEEP_ARCHIVE'
  | 'GLACIER_IR';
export type LocationConstraint =
  | 'local'
  | 'us-east-1'
  | 'us-west-1'
  | 'us-west-2'
  | 'eu-west-1'
  | 'eu-central-1'
  | 'ap-southeast-1'
  | 'ap-northeast-1'
  | 'sa-east-1';
export type VersioningStatus = 'Enabled' | 'Suspended';
export type EncryptionAlgorithm = 'AES256' | 'aws:kms';
export type ObjectLockMode = 'GOVERNANCE' | 'COMPLIANCE';
export type CannedACL =
  | 'private'
  | 'public-read'
  | 'public-read-write'
  | 'authenticated-read'
  | 'bucket-owner-read'
  | 'bucket-owner-full-control';
export type ACLPermission = 'FULL_CONTROL' | 'READ' | 'WRITE' | 'READ_ACP' | 'WRITE_ACP';

export interface Owner {
  id: string;
  displayName?: string;
}

export interface Bucket {
  name: string;
  locationConstraint: string;
  creationDate: Date;
}

export interface ObjectMetadata {
  bucket: string;
  key: string;
  versionId?: string;
  etag: string;
  size: number;
  lastModified: Date;
  storageClass: StorageClass;
  contentType?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  cacheControl?: string;
  expires?: Date;
  userMetadata: Record<string, string>;
  checksum?: Checksum;
  encryption?: ObjectEncryption;
  deleteMarker?: boolean;
  objectLock?: ObjectLockRetention;
}

export interface ObjectSummary {
  key: string;
  etag: string;
  size: number;
  lastModified: Date;
  storageClass: StorageClass;
  owner?: Owner;
}

export interface Checksum {
  crc32?: string;
  crc32c?: string;
  crc64nvme?: string;
  sha1?: string;
  sha256?: string;
}

export interface ObjectEncryption {
  algorithm: EncryptionAlgorithm;
  kmsKeyId?: string;
  bucketKeyEnabled?: boolean;
}

export interface ObjectLockRetention {
  mode: ObjectLockMode;
  retainUntilDate: Date;
  legalHold?: 'ON' | 'OFF';
}

export interface ListObjectsV2Request {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  continuationToken?: string;
  startAfter?: string;
  encodingType?: 'url';
}

export interface ListObjectsV2Result {
  name: string;
  prefix?: string;
  delimiter?: string;
  maxKeys: number;
  keyCount: number;
  isTruncated: boolean;
  contents: ObjectSummary[];
  commonPrefixes: string[];
  continuationToken?: string;
  nextContinuationToken?: string;
  startAfter?: string;
  encodingType?: 'url';
}

export interface PutObjectRequest {
  bucket: string;
  key: string;
  body: Buffer;
  metadata?: Partial<ObjectMetadata>;
}

export interface GetObjectResult {
  body: Buffer;
  metadata: ObjectMetadata;
}

export interface CopyObjectRequest {
  sourceBucket: string;
  sourceKey: string;
  sourceVersionId?: string;
  destinationBucket: string;
  destinationKey: string;
  metadataDirective?: 'COPY' | 'REPLACE';
  metadata?: Partial<ObjectMetadata>;
}

export interface CopyObjectResult {
  etag: string;
  lastModified: Date;
  versionId?: string;
}

export interface MultipartUpload {
  uploadId: string;
  bucket: string;
  key: string;
  initiated: Date;
  initiator: Owner;
  owner: Owner;
  storageClass: StorageClass;
  parts: MultipartPart[];
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
  size: number;
  lastModified: Date;
}

export interface CreateMultipartUploadResult {
  uploadId: string;
  bucket: string;
  key: string;
}

export interface UploadPartRequest {
  bucket: string;
  key: string;
  uploadId: string;
  partNumber: number;
  body: Buffer;
}

export interface CompleteMultipartUploadPart {
  partNumber: number;
  etag: string;
}

export interface CompleteMultipartUploadRequest {
  bucket: string;
  key: string;
  uploadId: string;
  parts: CompleteMultipartUploadPart[];
}

export interface CompleteMultipartUploadResult {
  bucket: string;
  key: string;
  etag: string;
  versionId?: string;
}

export interface ListPartsRequest {
  bucket: string;
  key: string;
  uploadId: string;
  partNumberMarker?: number;
  maxParts?: number;
}

export interface ListPartsResult {
  bucket: string;
  key: string;
  uploadId: string;
  parts: MultipartPart[];
  isTruncated: boolean;
  nextPartNumberMarker?: number;
}

export interface ListMultipartUploadsRequest {
  bucket: string;
  prefix?: string;
  keyMarker?: string;
  uploadIdMarker?: string;
  delimiter?: string;
  maxUploads?: number;
}

export interface ListMultipartUploadsResult {
  bucket: string;
  uploads: MultipartUpload[];
  commonPrefixes: string[];
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextUploadIdMarker?: string;
}

export interface Tag {
  key: string;
  value: string;
}

export interface TagSet {
  tags: Tag[];
}

export interface VersioningConfiguration {
  status?: VersioningStatus;
  mfaDelete?: 'Enabled' | 'Disabled';
}

export interface ObjectVersion {
  key: string;
  versionId: string;
  isLatest: boolean;
  isDeleteMarker?: boolean;
  etag?: string;
  size?: number;
  lastModified: Date;
  storageClass?: StorageClass;
  owner?: Owner;
}

export interface ListObjectVersionsResult {
  bucket: string;
  versions: ObjectVersion[];
  deleteMarkers: ObjectVersion[];
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
}

export interface CORSRule {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface BucketCORSConfiguration {
  rules: CORSRule[];
}

export interface LifecycleRule {
  id?: string;
  status: 'Enabled' | 'Disabled';
  filter?: LifecycleFilter;
  transitions?: LifecycleTransition[];
  expiration?: LifecycleExpiration;
  noncurrentVersionTransitions?: NoncurrentVersionTransition[];
  noncurrentVersionExpiration?: NoncurrentVersionExpiration;
}

export interface LifecycleFilter {
  prefix?: string;
  tags?: Tag[];
  and?: { prefix?: string; tags?: Tag[] };
}

export interface LifecycleTransition {
  date?: Date;
  days?: number;
  storageClass: StorageClass;
}

export interface LifecycleExpiration {
  date?: Date;
  days?: number;
  expiredObjectDeleteMarker?: boolean;
}

export interface NoncurrentVersionTransition {
  noncurrentDays: number;
  storageClass: StorageClass;
}

export interface NoncurrentVersionExpiration {
  noncurrentDays: number;
}

export interface Grantee {
  id?: string;
  type: 'CanonicalUser' | 'AmazonCustomerByEmail' | 'Group';
  uri?: string;
  emailAddress?: string;
}

export interface Grant {
  grantee: Grantee;
  permission: ACLPermission;
}

export interface AccessControlPolicy {
  owner: Owner;
  grants: Grant[];
}

export interface BucketPolicy {
  version: string;
  id?: string;
  statements: PolicyStatement[];
}

export interface PolicyStatement {
  sid?: string;
  effect: 'Allow' | 'Deny';
  principal: string | string[] | { aws?: string | string[] };
  action: string | string[];
  resource: string | string[];
  condition?: Record<string, Record<string, string | string[]>>;
}

export interface ServerSideEncryptionConfiguration {
  rules: ServerSideEncryptionRule[];
}

export interface ServerSideEncryptionRule {
  algorithm: EncryptionAlgorithm;
  kmsMasterKeyId?: string;
  bucketKeyEnabled?: boolean;
}

export interface WebsiteConfiguration {
  indexDocument?: { suffix: string };
  errorDocument?: { key: string };
  redirectAllRequestsTo?: { hostName: string; protocol?: string };
  routingRules?: RoutingRule[];
}

export interface RoutingRule {
  condition: { keyPrefixEquals?: string; httpErrorCodeReturnedEquals?: string };
  redirect: {
    hostName?: string;
    protocol?: string;
    replaceKeyPrefixWith?: string;
    replaceKeyWith?: string;
    httpRedirectCode?: string;
  };
}

export interface BucketLoggingStatus {
  targetBucket?: string;
  targetPrefix?: string;
}

export interface NotificationConfiguration {
  queueConfigurations?: NotificationQueueConfiguration[];
  topicConfigurations?: NotificationTopicConfiguration[];
  lambdaConfigurations?: NotificationLambdaConfiguration[];
  eventBridgeEnabled?: boolean;
}

export interface NotificationFilter {
  key?: { filterRules: { name: 'prefix' | 'suffix'; value: string }[] };
}

export interface NotificationQueueConfiguration {
  id?: string;
  queue: string;
  events: string[];
  filter?: NotificationFilter;
}

export interface NotificationTopicConfiguration {
  id?: string;
  topic: string;
  events: string[];
  filter?: NotificationFilter;
}

export interface NotificationLambdaConfiguration {
  id?: string;
  function: string;
  events: string[];
  filter?: NotificationFilter;
}

export interface ReplicationConfiguration {
  role: string;
  rules: ReplicationRule[];
}

export interface ReplicationRule {
  id?: string;
  priority?: number;
  status: 'Enabled' | 'Disabled';
  filter?: LifecycleFilter;
  destination: ReplicationDestination;
  deleteMarkerReplication?: { status: 'Enabled' | 'Disabled' };
}

export interface ReplicationDestination {
  bucket: string;
  account?: string;
  storageClass?: StorageClass;
  encryptionConfiguration?: { replicaKmsKeyId: string };
}

export interface S3StorageContract {
  listBuckets(): Promise<Bucket[]>;
  createBucket(bucket: Bucket): Promise<void>;
  headBucket(bucket: string): Promise<void>;
  deleteBucket(bucket: string): Promise<void>;
  putObject(request: PutObjectRequest): Promise<ObjectMetadata>;
  getObject(bucket: string, key: string, versionId?: string): Promise<GetObjectResult>;
  headObject(bucket: string, key: string, versionId?: string): Promise<ObjectMetadata>;
  deleteObject(bucket: string, key: string, versionId?: string): Promise<void>;
  listObjectsV2(request: ListObjectsV2Request): Promise<ListObjectsV2Result>;
  copyObject(request: CopyObjectRequest): Promise<CopyObjectResult>;
  createMultipartUpload(bucket: string, key: string): Promise<CreateMultipartUploadResult>;
  uploadPart(request: UploadPartRequest): Promise<MultipartPart>;
  completeMultipartUpload(request: CompleteMultipartUploadRequest): Promise<CompleteMultipartUploadResult>;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;
  listParts(request: ListPartsRequest): Promise<ListPartsResult>;
  listMultipartUploads(request: ListMultipartUploadsRequest): Promise<ListMultipartUploadsResult>;
}
