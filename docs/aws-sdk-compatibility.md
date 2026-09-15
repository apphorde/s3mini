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
  region: 'us-east-1',
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
| List buckets | `ListBucketsCommand` | Required |
| List objects | `ListObjectsV2Command` | Required |
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

Authentication, XML error codes, HTTP status codes, ETags, metadata headers,
path-style addressing, pagination, and conditional requests are part of each
operation's compatibility requirement.

Features outside this core target remain explicitly unsupported until they have
dedicated behavior and SDK tests.

The compatibility suite currently verifies 34 tests, including AWS SDK v3
bucket/object CRUD, pagination, multipart upload, CopyObject, tagging,
versioning, ranges, checksums, and conditional reads.
