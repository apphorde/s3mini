# S3MINI Feature Catalog

This document separates the AWS S3 surface area from the subset currently implemented by
S3MINI. A checked item means implemented and tested; an unchecked item is planned or out of
scope. The server is API-only and stores its SQLite metadata and object files below `/data`.

## Implemented

- [x] ListBuckets: `GET /`
- [x] CreateBucket: `PUT /{bucket}`
- [x] HeadBucket: `HEAD /{bucket}`
- [x] DeleteBucket: `DELETE /{bucket}`
- [x] PutObject: `PUT /{bucket}/{key}`
- [x] GetObject: `GET /{bucket}/{key}`
- [x] HeadObject: `HEAD /{bucket}/{key}`
- [x] DeleteObject: `DELETE /{bucket}/{key}`
- [x] ListObjectsV2: `GET /{bucket}` with `prefix`
- [x] S3-style XML errors for implemented operations
- [x] Basic object metadata: content type, disposition, encoding, cache control, expires, storage class
- [x] Persistent hybrid storage: SQLite metadata and binary files under `/data/objects`
- [x] Docker image exposing port `9000`

## Planned S3 API Features

### Multipart Uploads

- [ ] CreateMultipartUpload
- [ ] UploadPart
- [ ] UploadPartCopy
- [ ] ListParts
- [ ] ListMultipartUploads
- [ ] CompleteMultipartUpload
- [ ] AbortMultipartUpload

### Versioning and Tagging

- [ ] PutBucketVersioning / GetBucketVersioning
- [ ] ListObjectVersions
- [ ] DeleteObject version and delete-marker semantics
- [ ] PutObjectTagging / GetObjectTagging / DeleteObjectTagging
- [ ] PutBucketTagging / GetBucketTagging / DeleteBucketTagging

### Bucket Configuration

- [ ] GetBucketLocation
- [ ] Bucket ACLs and object ACLs
- [ ] CORS configuration
- [ ] Lifecycle configuration
- [ ] Bucket policy and public-access-block configuration
- [ ] Website configuration
- [ ] Default encryption configuration
- [ ] Requester pays, logging, notifications, replication, analytics, metrics, and inventory

### Object Features

- [ ] CopyObject and UploadPartCopy
- [ ] Conditional requests and byte ranges
- [ ] Checksum validation and response checksums
- [ ] Server-side encryption behavior (SSE-S3, SSE-KMS, SSE-C)
- [ ] Object Lock, legal holds, and retention
- [ ] RestoreObject and SelectObjectContent
- [ ] SigV4 authentication and presigned URL validation

### Control-Plane and Specialized AWS Features

- [ ] S3 Access Points and Object Lambda
- [ ] Multi-Region Access Points
- [ ] S3 Batch Operations
- [ ] Storage Lens
- [ ] S3 Express directory buckets

## Explicitly Out of Scope

- [ ] Multi-tier storage and automatic transitions between storage classes
- [ ] Glacier, Deep Archive, and Intelligent-Tiering backends
- [ ] Replication to external regions or storage systems
- [ ] A web UI; S3MINI provides an API only

The feature list is intentionally explicit so the OpenAPI contract and implementation status do
not imply AWS compatibility that has not yet been delivered.
