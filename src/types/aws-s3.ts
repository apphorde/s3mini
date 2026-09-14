// Type-only aliases to the official AWS SDK v3 S3 declarations.
// Keep internal storage models separate where they represent normalized data.

export type {
  AbortMultipartUploadCommandInput,
  AbortMultipartUploadCommandOutput,
  CompleteMultipartUploadCommandInput,
  CompleteMultipartUploadCommandOutput,
  CopyObjectCommandInput,
  CopyObjectCommandOutput,
  CreateBucketCommandInput,
  CreateBucketCommandOutput,
  CreateMultipartUploadCommandInput,
  CreateMultipartUploadCommandOutput,
  DeleteBucketCommandInput,
  DeleteBucketCommandOutput,
  DeleteObjectCommandInput,
  DeleteObjectCommandOutput,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  HeadBucketCommandInput,
  HeadBucketCommandOutput,
  HeadObjectCommandInput,
  HeadObjectCommandOutput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  UploadPartCommandInput,
  UploadPartCommandOutput,
} from '@aws-sdk/client-s3';

export type {
  Bucket,
  CommonPrefix,
  CompletedPart,
  CompletedMultipartUpload,
  ListObjectsV2Request,
  ListObjectsV2Output,
  ObjectIdentifier,
  Owner,
  Part,
  Tag,
} from '@aws-sdk/client-s3';

export type AwsObject = import('@aws-sdk/client-s3')._Object;

export type {
  BucketCannedACL,
  BucketVersioningStatus,
  ChecksumAlgorithm,
  ObjectCannedACL,
  ObjectLockLegalHoldStatus,
  ObjectLockMode,
  ServerSideEncryption,
  StorageClass,
} from '@aws-sdk/client-s3';
