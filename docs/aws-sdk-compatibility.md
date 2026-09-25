# AWS S3 Core Compatibility

S3MINI targets the common S3 protocol used by AWS S3, MinIO, and Backblaze B2's
S3-compatible API. The primary acceptance client is AWS SDK for JavaScript v3
(`@aws-sdk/client-s3`) against a self-hosted path-style endpoint. The SDK is a
development dependency with bundled declarations exposed through
`src/types/aws-s3.ts`; internal storage models remain normalized instead of
duplicating AWS wire types.

## Client Defaults

```ts
const client = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'local',
  forcePathStyle: true,
  credentials: {
    accessKeyId: 's3mini',
    secretAccessKey: 's3mini-secret',
  },
});
```

## Core Acceptance Matrix

| Operation | AWS SDK command | Target |
| --- | --- | --- |
| Create bucket | `CreateBucketCommand` | Required |
| Head bucket | `HeadBucketCommand` | Required |
| Delete bucket | `DeleteBucketCommand` | Required |
| Put object | `PutObjectCommand` | Required |
| Get object | `GetObjectCommand` | Required |
| Head object | `HeadObjectCommand` | Required |
| Delete object | `DeleteObjectCommand` | Required |
| Delete objects | `DeleteObjectsCommand` | Required |
| List buckets | `ListBucketsCommand` | Required |
| List objects | `ListObjectsV2Command` | Required |
| List objects v1 | Legacy `GET` with `list-type=1` | Implemented |
| Copy object | `CopyObjectCommand` | Required |
| Multipart upload | Create/upload/list/complete/abort | Required |
| Bucket versioning | Put/get versioning | Required |
| Object tagging | Put/get/delete tagging | Required |
| Object ranges | `GetObjectCommand` with `Range` | Required |
| Object checksums | SHA-256 request/response checksums | Required |
| Lifecycle expiration | Prefix/day expiration subset | Partial |
| Bucket policy | Allow/Deny statements, wildcard matching, principals, and basic string conditions | Partial |
| Object ACL grants | Canned ACLs and XML read grants for public/authenticated principals | Partial |
| Content-MD5 and language | Request digest validation and `Content-Language` round-trip | Implemented |
| Lifecycle XML configuration | AWS-style lifecycle rules accepted through bucket API | Partial |
| Payload digests | AWS SHA-256 and Backblaze SHA-1 request validation | Implemented |
| Storage classes | Supported storage-class enum validation | Implemented |
| List encoding | ListObjectsV2 `encoding-type=url` response mode | Implemented |
| Persistence | Node `node:sqlite` metadata database and access-key primitives | Implemented |
| Access-key control plane | Bearer-protected list, issue, and disable endpoints | Implemented |
| Admin dashboard | Li3 single-page `/admin` key, bucket, and replication-health view | Implemented |
| XML error safety | Escaped error and response values for AWS-compatible XML clients | Implemented |
| AWS request identifiers | `x-amz-request-id` and `x-amz-id-2` response headers | Implemented |
| Replication durability | Atomic local writes and transactional replication intent journal | Partial |
| Peer object delivery | Authenticated asynchronous object-write delivery | Partial |

Authentication, XML error codes, HTTP status codes, ETags, metadata headers,
path-style addressing, pagination, and conditional requests are part of each
operation's compatibility requirement.

Provider-issued bearer tokens are supported for API calls. Use `s3:read` for
reads, `s3:write` for bucket/object mutations, `s3:admin` for administrative
configuration and control-plane actions, or `s3:*` for full access.

Features outside this core target remain explicitly unsupported until they have
dedicated behavior and SDK tests.

The current test suite has 83 tests. AWS SDK v3 coverage includes bucket/object
CRUD, batch deletion, authentication, multipart upload, tagging, and versioning;
direct HTTP coverage exercises pagination, CopyObject, ranges, checksums, and
conditional reads. Opt-in MinIO and Backblaze B2 interoperability coverage is
available in `src/test/s3-compatibility.test.ts`; set the corresponding
`S3MINI_MINIO_*` or `S3MINI_B2_*` endpoint and credential variables before
running it. Scale-oriented features are deferred.
