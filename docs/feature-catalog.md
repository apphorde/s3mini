# S3MINI Feature Catalog

This document separates the AWS S3 surface area from the subset currently implemented by
S3MINI. A checked item means implemented and tested; an unchecked item is planned or out of
scope. The server is API-only and stores its SQLite metadata and object files below `/data`.

## Priority Policy

S3MINI optimizes for a small deployment and dependable common-client behavior,
not large or high-volume storage. Prioritize features in this order:

1. **Essential:** core bucket/object operations, correct S3 errors and headers,
   authentication and authorization, integrity checks, local durability, and
   AWS SDK v3/MinIO/Backblaze B2 interoperability.
2. **Useful:** commonly requested S3 features that can be implemented without
   changing the storage model, such as tagging, versioning, lifecycle, and
   multipart uploads.
3. **Deferred:** features whose primary value is scale, multi-region operation,
   fleet management, or high-volume optimization.

Do not start deferred work while essential compatibility or single-node
recovery behavior has known gaps.

## Implemented

- [x] ListBuckets: `GET /`
- [x] CreateBucket: `PUT /{bucket}`
- [x] HeadBucket: `HEAD /{bucket}`
- [x] DeleteBucket: `DELETE /{bucket}`
- [x] PutObject: `PUT /{bucket}/{key}`
- [x] GetObject: `GET /{bucket}/{key}`
- [x] HeadObject: `HEAD /{bucket}/{key}`
- [x] DeleteObject: `DELETE /{bucket}/{key}`
- [x] DeleteObjects: `POST /{bucket}?delete`
- [x] ListObjectsV2: `GET /{bucket}` with `prefix`
- [x] ListObjects: `GET /{bucket}?list-type=1` with marker pagination
- [x] S3-style XML errors for implemented operations
- [x] Basic object metadata: content type, disposition, encoding, cache control, expires, storage class
- [x] Persistent hybrid storage: SQLite metadata in `/data/s3mini.sqlite` and binary files under `/data/objects`
- [x] Persistent access-key storage, role-authorized HTTP control plane, and lightweight `/admin` dashboard
- [x] Replicated OIDC `viewer`, `operator`, and `admin` roles with revocation tombstones and admin management UI
- [x] Local durability journal for asynchronous replication
- [x] Asynchronous authenticated peer delivery for object writes, deletes, and delete markers (anti-entropy repair and quorum pending)
- [x] Docker image exposing port `9000` with the Node SQLite-compatible base image
- [x] ListObjectsV2 pagination and delimiter/common-prefix handling
- [x] Multipart upload lifecycle: initiate, upload, list, complete, and abort
- [x] Object version listing and version-specific reads/deletes
- [x] Object and bucket tagging
- [x] Bucket location, configuration persistence, and CORS preflight handling
- [x] CopyObject, byte ranges, conditional reads, and SHA-256 checksums
- [x] Content-MD5 validation and Content-Language metadata
- [x] AWS `x-amz-content-sha256` and Backblaze `x-bz-content-sha1` payload validation
- [x] Storage-class validation for supported transition classes
- [x] Server-side encryption metadata for AES256 and aws:kms requests
- [x] Object-lock retention and legal-hold deletion checks
- [x] RestoreObject and basic `SELECT * FROM S3Object` behavior
- [x] Optional SigV4 header and presigned URL verification
- [x] AWS SDK for JavaScript v3 compatibility smoke tests
- [x] Self-hosted path-style endpoint support

## Planned S3 API Features

### Multipart Uploads

- [x] CreateMultipartUpload
- [x] UploadPart
- [x] UploadPartCopy
- [x] ListParts
- [x] ListMultipartUploads
- [x] CompleteMultipartUpload
- [x] AbortMultipartUpload

### Versioning and Tagging

- [x] PutBucketVersioning / GetBucketVersioning
- [x] ListObjectVersions
- [x] DeleteObject version and delete-marker semantics
- [x] PutObjectTagging / GetObjectTagging / DeleteObjectTagging
- [x] PutBucketTagging / GetBucketTagging / DeleteBucketTagging

### Bucket Configuration

- [x] GetBucketLocation
- [x] Bucket ACL configuration
- [x] Object ACL storage, query operations, canned ACLs, and basic owner/grant authorization (partial)
- [x] CORS configuration and preflight behavior
- [x] Lifecycle XML/JSON configuration, expiration, current/noncurrent transitions, and noncurrent-version expiration (lazy processing)
- [x] Bucket policy Allow/Deny enforcement with wildcard principals, actions, resources, and basic string conditions (partial)
- [ ] Website configuration
- [ ] Default encryption configuration
- [ ] Requester pays, logging, notifications, analytics, and metrics

### Object Features

- [x] CopyObject
- [x] UploadPartCopy
- [x] Conditional requests and byte ranges
- [x] SHA-256 checksum validation and response checksums
- [x] Server-side encryption metadata for SSE-S3/SSE-KMS request modes
- [x] Object Lock, legal holds, and retention checks
- [x] RestoreObject and basic SelectObjectContent
- [x] Optional SigV4 authentication and presigned URL validation

### Control-Plane and Specialized AWS Features

- [ ] S3 Access Points and Object Lambda
- [ ] Multi-Region Access Points
- [ ] S3 Batch Operations
- [ ] Storage Lens
- [ ] S3 Express directory buckets

## Explicitly Out of Scope

- [x] Lifecycle metadata transitions between supported storage classes
- [ ] Glacier, Deep Archive, and Intelligent-Tiering backends
- [ ] Replication to external regions or storage systems
- [ ] A standalone general-purpose web UI; the embedded `/admin` dashboard is limited to control-plane operations
- [ ] Large-scale storage optimization, high-volume throughput tuning, and
  multi-region/high-availability guarantees

The feature list is intentionally explicit so the OpenAPI contract and implementation status do
not imply AWS compatibility that has not yet been delivered.
