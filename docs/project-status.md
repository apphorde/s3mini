# Project Status

## Current Target

S3MINI targets the common AWS S3 protocol used by self-hosted S3-compatible
services, with AWS SDK for JavaScript v3 as the primary interoperability client.
The compatibility mode is path-style addressing and can be used with a local,
container, or reverse-proxied deployment.

The near-term priority is a small, dependable S3 service, not a large-scale or
high-volume storage platform. Feature work should first improve correctness,
durability on one node, security, and compatibility with common S3 clients.
Cluster-scale replication, high availability, and operational UI enhancements
remain secondary until the core S3 path is complete and well tested.

## Current Progress

- Core bucket and object CRUD is implemented.
- New buckets default to the self-hosted `local` location; AWS-compatible and custom self-hosted labels such as `ams` and `ind` are supported. Location is a bucket region label, not a node identity.
- ListObjectsV2 supports prefixes, delimiters, common prefixes, pagination, and continuation tokens.
- Legacy ListObjects supports marker pagination for clients that do not use ListObjectsV2.
- Multipart upload lifecycle and UploadPartCopy are implemented.
- Versioning, version-specific reads/deletes, and delete markers are implemented.
- Bucket and object tagging and ACL query operations are implemented.
- Bucket policy evaluation supports explicit Allow/Deny statements, wildcard actions/resources, principals, and basic string conditions.
- Object ACL authorization supports owner access, canned ACLs, and XML grants for anonymous/public and authenticated reads when authentication is configured.
- PutObject validates `Content-MD5` when supplied and preserves `Content-Language` metadata for common S3-compatible clients.
- PutObject, CopyObject, and CompleteMultipartUpload expose ETag and version headers; GET/HEAD round-trip storage class, expiration, version, and checksum metadata.
- Lifecycle configuration accepts AWS-style XML over the HTTP API and applies the parsed rules lazily during reads and listings.
- Payload integrity accepts AWS SHA-256 and Backblaze SHA-1 headers in addition to Content-MD5.
- Object storage classes are validated against the supported API enum before persistence.
- ListObjectsV2 supports AWS `encoding-type=url` responses for reserved characters in keys and prefixes.
- SQLite metadata now uses `/data/s3mini.sqlite` through Node's built-in `node:sqlite` driver, with legacy `/data/objects/meta.db` migration on first start.
- Persistent access-key storage, a bearer-token-protected HTTP control plane, and a Li3-based `/admin` single-page dashboard are implemented for listing, issuing, and disabling keys.
- Local durability foundation is implemented: WAL/full-sync SQLite, atomic synced object writes, and a transactional pending replication journal.
- Durable object renames now sync their parent directories, missing committed version files fail closed, and deleting one key no longer removes other keys' version files.
- Asynchronous peer delivery is implemented for object writes, deletes, and delete markers using `S3MINI_REPLICATION_PEERS`, `S3MINI_REPLICATION_TOKEN`, and `S3MINI_NODE_ID`; initial geolocated testing can use private VPN endpoints.
- The replication worker compares authenticated peer inventories and replays missing local journal events.
- Configured peer health is persisted in SQLite and exposed through the authenticated control plane; replicated PUTs validate their MD5 ETag and inventory repair compares ETags.
- Replication workers claim per-peer pending events with expiring SQLite leases, preventing duplicate concurrent delivery while allowing crash recovery and independent retry of only failed peers.
- Replication quorum configuration and degraded-state reporting are available through `S3MINI_REPLICATION_QUORUM` and the authenticated `/admin/replication/summary` endpoint; writes remain asynchronous until quorum acknowledgement is implemented.
- Replication events that exhaust eight delivery attempts are persisted as dead letters, listed through the admin API, and can be explicitly requeued.
- New replication events persist a SHA-256 body digest, include it in delivery headers, validate it at the receiving node, and compare it during inventory repair; legacy events retain ETag fallback behavior.
- The Li3 admin dashboard displays bucket, access-key, peer-health, replication-event, and dead-letter state, with bucket creation, policy navigation, key issuing, and retry-related API views.
- The authenticated control plane now supports bucket create/list/delete and bucket policy get/update/delete operations, surfaced in the dashboard.
- Dashboard access can use PKCE OIDC login through the configured `AUTH_PROVIDER`; the resulting HttpOnly session token is verified with the provider's RS256 JWKS, checked against `/userinfo` with `X-Auth-Audience`, and requires an email listed in `S3MINI_OIDC_ADMIN_EMAILS`.
- Provider-issued opaque API tokens are accepted through bearer authentication; `s3:read`, `s3:write`, `s3:admin`, and `s3:*` scopes are enforced through the provider's `/oauth/introspect` endpoint.
- OIDC setup is documented in `README.md`: register `/auth/callback`, configure client credentials and audience, and use `S3MINI_OIDC_ADMIN_EMAILS` to restrict administrators.
- `.env.example` and the production container default wire the OIDC provider URL into the application without including credentials.
- The live deployment names `AUTH_PROVIDER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` are accepted directly, with `S3MINI_OIDC_*` aliases retained.
- The dashboard clears its HttpOnly OIDC token on logout and redirects expired or unauthorized API sessions back to the login flow.
- The dashboard is a Li3 component-based single-page UI with local Tailwind v4 output; it uses reactive bindings/templates for buckets, policies, account actions, mobile navigation, and the current OIDC profile without direct DOM manipulation.
- The distributed-storage replacement roadmap and reliability invariants are documented in `docs/distributed-roadmap.md`.
- CORS configuration, preflight behavior, object copy, ranges, conditionals, checksums, encryption metadata, and object lock are implemented.
- Lifecycle transitions for current and noncurrent versions, plus noncurrent-version expiration, are implemented with lazy processing during reads and listings.
- RestoreObject and a limited `SELECT * FROM S3Object` operation are implemented.
- Optional SigV4 header and presigned URL verification are implemented.
- AWS SDK v3 tests cover bucket/object CRUD, pagination, and multipart upload.
- AWS SDK v3 tests also cover CopyObject, tagging, versioning, ranges, checksums, and conditional reads.
- HTTP coverage includes bucket configuration, multipart listing/abort, object copy/batch deletion, authentication-required mutations, and the OIDC callback; opt-in MinIO and Backblaze B2 coverage is available through `src/test/s3-compatibility.test.ts`.
- The current compatibility checkpoint is tracked in git history with 80 passing tests.
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

1. Close correctness and error-semantics gaps in the implemented AWS S3 operations.
2. Expand interoperability tests for AWS SDK v3, MinIO, and Backblaze B2 clients.
3. Harden single-node durability, recovery, authentication, authorization, and request validation.
4. Keep the dashboard node-local; defer cross-node aggregation, quorum acknowledgement, multi-master behavior, and other scale-oriented work unless a concrete deployment requires them.

## Next Session Handoff

Start by checking `git status`, recent history, and the todo list. Preserve the
AWS SDK v3 test harness in `src/test/aws-sdk.test.ts` and keep the compatibility
suite green.

## Known Scope

S3 Access Points, Object Lambda, Multi-Region Access Points, Batch Operations,
Storage Lens, S3 Express directory buckets, external replication, and a standalone
web UI are not part of the current implementation target; the embedded admin
dashboard is intentionally limited to control-plane operations.

No credentials, signing secrets, private deployment configuration, or production
environment values belong in this repository.
