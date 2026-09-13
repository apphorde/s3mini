# S3MINI — Feature Completeness Catalog

## What We WILL Implement (S3-Compatible Subset)

### Bucket Operations
- [x] CreateBucket (`PUT /?create`)
- [x] DeleteBucket (`DELETE /`)
- [x] ListBuckets (`GET /`)
- [x] HeadBucket (`HEAD /`)
- [x] GetBucketLocation (`GET /?location`)

### Object Operations (Core CRUD)
- [x] PutObject (`PUT /{key}`)
- [x] GetObject (`GET /{key}`)
- [x] HeadObject (`HEAD /{key}`)
- [x] DeleteObject (`DELETE /{key}`)
- [x] CopyObject (`PUT x-amz-copy-source`)
- [x] ListObjectsV2 (`GET /?list-type=2`)

### Multipart Uploads
- [x] CreateMultipartUpload (`POST /{key}?uploads`)
- [x] UploadPart (`PUT /{key}?uploadId=X&partNumber=Y`)
- [x] ListParts (`GET /{key}?uploadId=X`)
- [x] AbortMultipartUpload (`DELETE /{key}?uploadId=X`)
- [x] CompleteMultipartUpload (`POST /{key}?uploadId=X`)

### Object Tagging
- [x] PutObjectTagging (`PUT /{key}?tagging`)
- [x] GetObjectTagging (`GET /{key}?tagging`)
- [x] DeleteObjectTagging (`DELETE /{key}?tagging`)

### Versioning
- [x] PutBucketVersioning (`PUT Bucket?versioning`)
- [x] GetBucketVersioning (`GET Bucket?versioning`)

### Server-Side Encryption Headers (passthrough, no actual encryption)
- [x] x-amz-server-side-encryption (all object operations)
- [x] x-amz-server-side-encryption-aws-kms-key-id
- [x] x-amz-server-side-encryption-context
- [x] x-amz-client-side-encryption*
- [ ] SSE-S3, SSE-KMS, SSE-C — documented as passthrough in headers

### Object Metadata (user & system)
- [x] Content-Type, Content-Length, ETag, Last-Modified
- [x] x-amz-meta-* custom metadata
- [x] Cache-Control, Content-Disposition, Content-Encoding, Content-Language, Expires

### Common S3-style Error Responses
> All documented in the OpenAPI spec below.

---

## What We WILL NOT Implement (Out of Scope)

### Tiered/Intelligent Storage
- [ ] Infrequent Access / IA storage class
- [ ] Glacier / Deep Archive restoration
- [ ] Intelligent-Tiering configuration
- [ ] Lifecycle transition rules to cold tiers
> _We may support `STANDARD` and `ONEZONE_IA` storage-class metadata, but no actual tiering logic._

### Replication
- [ ] Cross-Region Replication (CRR)
- [ ] Source-controlled replication
- [ ] Multi-Region Access Points (MRAP)

### Advanced S3 features that don't make sense for a tiny server
- [ ] Object Lock / WORM retention
- [ ] Bucket policy enforcement
- [ ] Presigned URL validation with AWS SigV4 signing *generation* (we just accept requests signed by the client). _We do NOT implement presigned-URL **creation** either to keep it simple._
- [ ] S3 Select (`?select`)
- [ ] Inventory configuration
- [ ] Analytics metrics / reports
- [ ] Notification configuration (Lambda/SNS/Queue)
- [ ] Access Point, Multi-Part Upload with parallel uploads across regions
- [ ] Object Lambda Access Points
- [ ] Direct S3 Transfer acceleration (cloudfront backends)
