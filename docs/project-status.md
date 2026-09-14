# Project Status

## Current Target

S3MINI targets the common AWS S3 protocol used by self-hosted S3-compatible
services, with AWS SDK for JavaScript v3 as the primary interoperability client.
The compatibility mode is path-style addressing and can be used with a local,
container, or reverse-proxied deployment.

## Current Progress

- Core bucket and object CRUD is implemented.
- ListObjectsV2 supports prefixes, delimiters, common prefixes, pagination, and continuation tokens.
- Multipart upload lifecycle and UploadPartCopy are implemented.
- Versioning, version-specific reads/deletes, and delete markers are implemented.
- Bucket and object tagging and ACL query operations are implemented.
- CORS configuration, preflight behavior, object copy, ranges, conditionals, checksums, encryption metadata, and object lock are implemented.
- RestoreObject and a limited `SELECT * FROM S3Object` operation are implemented.
- Optional SigV4 header and presigned URL verification are implemented.
- AWS SDK v3 tests cover bucket/object CRUD, pagination, and multipart upload.
- AWS SDK v3 tests also cover CopyObject, tagging, versioning, ranges, checksums, and conditional reads.
- The deployed service has been smoke-tested through its public reverse-proxied endpoint.

## Verification

Run the local checks:

```sh
npm test
npm run build
```

The test suite includes direct storage tests, HTTP integration tests, and AWS
SDK v3 compatibility tests. SQLite-backed tests run serially to avoid concurrent
database locking during test execution.

## Next Steps

1. Expand AWS SDK coverage for `HeadObject`, metadata, conditional requests, tagging, and versioning.
2. Expand lifecycle processing beyond expiration to transitions and noncurrent versions.
3. Expand bucket-policy and public-access enforcement beyond explicit deny statements.
4. Improve object ACL semantics and authorization enforcement.
5. Add compatibility tests for MinIO and Backblaze B2 where behavior overlaps with the AWS S3 core.
6. Continue tightening AWS-compatible status codes, error XML, headers, and edge cases.

## Known Scope

S3 Access Points, Object Lambda, Multi-Region Access Points, Batch Operations,
Storage Lens, S3 Express directory buckets, external replication, and a web UI
are not part of the current implementation target.

No credentials, signing secrets, private deployment configuration, or production
environment values belong in this repository.
