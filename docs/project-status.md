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
- Bucket policy evaluation supports explicit Allow/Deny statements, wildcard actions/resources, principals, and basic string conditions.
- Object ACL authorization supports owner access, canned ACLs, and XML grants for anonymous/public and authenticated reads when authentication is configured.
- PutObject validates `Content-MD5` when supplied and preserves `Content-Language` metadata for common S3-compatible clients.
- Lifecycle configuration accepts AWS-style XML over the HTTP API and applies the parsed rules lazily during reads and listings.
- Payload integrity accepts AWS SHA-256 and Backblaze SHA-1 headers in addition to Content-MD5.
- Object storage classes are validated against the supported API enum before persistence.
- CORS configuration, preflight behavior, object copy, ranges, conditionals, checksums, encryption metadata, and object lock are implemented.
- Lifecycle transitions for current and noncurrent versions, plus noncurrent-version expiration, are implemented with lazy processing during reads and listings.
- RestoreObject and a limited `SELECT * FROM S3Object` operation are implemented.
- Optional SigV4 header and presigned URL verification are implemented.
- AWS SDK v3 tests cover bucket/object CRUD, pagination, and multipart upload.
- AWS SDK v3 tests also cover CopyObject, tagging, versioning, ranges, checksums, and conditional reads.
- The current compatibility checkpoint is tracked in git history with 43 passing tests.
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

1. Add compatibility tests for MinIO and Backblaze B2 where behavior overlaps with the AWS S3 core.
2. Continue tightening AWS-compatible status codes, error XML, headers, and edge cases.

## Next Session Handoff

Start by checking `git status`, recent history, and the todo list. The next
implementation slice should be MinIO/Backblaze compatibility coverage. Preserve the AWS SDK
v3 test harness in `src/test/aws-sdk.test.ts` and keep the compatibility suite
green.

## Known Scope

S3 Access Points, Object Lambda, Multi-Region Access Points, Batch Operations,
Storage Lens, S3 Express directory buckets, external replication, and a web UI
are not part of the current implementation target.

No credentials, signing secrets, private deployment configuration, or production
environment values belong in this repository.
