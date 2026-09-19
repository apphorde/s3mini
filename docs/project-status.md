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
- ListObjectsV2 supports AWS `encoding-type=url` responses for reserved characters in keys and prefixes.
- SQLite metadata now uses `/data/s3mini.sqlite` through Node's built-in `node:sqlite` driver, with legacy `/data/objects/meta.db` migration on first start.
- Persistent access-key storage, a bearer-token-protected HTTP control plane, and a dependency-free `/admin` dashboard are implemented for listing, issuing, and disabling keys.
- Local durability foundation is implemented: WAL/full-sync SQLite, atomic synced object writes, and a transactional pending replication journal.
- Asynchronous peer delivery is implemented for object writes, deletes, and delete markers using `S3MINI_REPLICATION_PEERS`, `S3MINI_REPLICATION_TOKEN`, and `S3MINI_NODE_ID`; initial geolocated testing can use private VPN endpoints.
- The replication worker compares authenticated peer inventories and replays missing local journal events.
- Configured peer health is persisted in SQLite and exposed through the authenticated control plane; replicated PUTs validate their MD5 ETag and inventory repair compares ETags.
- Replication workers claim pending events with expiring SQLite leases, preventing duplicate concurrent delivery while allowing crash recovery.
- Replication events that exhaust eight delivery attempts are persisted as dead letters, listed through the admin API, and can be explicitly requeued.
- New replication events persist a SHA-256 body digest, include it in delivery headers, and validate it at the receiving node.
- CORS configuration, preflight behavior, object copy, ranges, conditionals, checksums, encryption metadata, and object lock are implemented.
- Lifecycle transitions for current and noncurrent versions, plus noncurrent-version expiration, are implemented with lazy processing during reads and listings.
- RestoreObject and a limited `SELECT * FROM S3Object` operation are implemented.
- Optional SigV4 header and presigned URL verification are implemented.
- AWS SDK v3 tests cover bucket/object CRUD, pagination, and multipart upload.
- AWS SDK v3 tests also cover CopyObject, tagging, versioning, ranges, checksums, and conditional reads.
- The current compatibility checkpoint is tracked in git history with 50 passing tests.
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

1. Extend SHA-256 metadata validation to inventory comparisons and older event migration paths.
2. Add bucket/policy management to the authenticated control plane and dashboard.
3. Add compatibility tests for MinIO and Backblaze B2 where behavior overlaps with the AWS S3 core.
4. Continue tightening AWS-compatible status codes, error XML, headers, and edge cases.

## Next Session Handoff

Start by checking `git status`, recent history, and the todo list. The next
implementation slice should be stronger checksum verification. Preserve the AWS SDK
v3 test harness in `src/test/aws-sdk.test.ts` and keep the compatibility suite
green.

## Known Scope

S3 Access Points, Object Lambda, Multi-Region Access Points, Batch Operations,
Storage Lens, S3 Express directory buckets, external replication, and a web UI
are not part of the current implementation target.

No credentials, signing secrets, private deployment configuration, or production
environment values belong in this repository.
