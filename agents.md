# Agent Instructions

## Project Goal

Maintain S3MINI as a small, self-hosted S3-compatible object storage service.
Prioritize behavior that works with AWS SDK for JavaScript v3 and common
self-hosted clients such as MinIO clients and compatible tooling.

## Engineering Rules

- Inspect the current implementation before changing it.
- Prefer small, testable changes over broad rewrites.
- Preserve existing behavior unless the change is intentionally compatibility-related.
- Keep API contracts and type definitions stable while implementing them incrementally.
- Use SQLite for metadata and the configured filesystem storage area for object data.
- Treat XML status codes, headers, ETags, request IDs, and error codes as part of the public API.
- Add or update tests for every behavior change.
- Run `npm test` and `npm run build` before creating a checkpoint.
- Keep SQLite-backed tests serialized to avoid database-lock races.
- Review `git diff`, `git status`, and recent history before committing.
- After every commit, update the todo list immediately.
- Push only after the checkpoint passes verification.

## Compatibility Priorities

1. AWS S3 core behavior.
2. AWS SDK v3 interoperability using path-style endpoints.
3. Shared behavior with MinIO and Backblaze B2 S3 APIs.
4. Clear, documented deviations for unsupported features.

## Scope Priorities

- Optimize for a small, reliable deployment rather than large or high-volume storage.
- Treat core S3 semantics, local durability, security, recovery, and common-client tests as higher priority than distributed scale features.
- Defer quorum acknowledgement, multi-master behavior, high-availability guarantees, throughput tuning, and dashboard polish unless a concrete core-S3 requirement depends on them.

## Current Handoff

- Latest pushed checkpoint: inspect the most recent commit on `main`.
- Verification baseline: 81 tests passing and `npm run build` passing.
- AWS SDK v3 coverage includes CRUD, pagination, multipart uploads, CopyObject,
  DeleteObjects, tagging, versioning, ranges, checksums, metadata, and conditionals.
- Next implementation slice: close core S3 correctness gaps and add compatibility coverage for remaining MinIO and Backblaze B2 edge cases. OIDC dashboard polish and distributed-storage enhancements are deferred unless required by a concrete deployment need. Keep all credentials, allowlists, and private test-node configuration in environment variables.
- OIDC configuration reference: live names `AUTH_PROVIDER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`; optional `S3MINI_OIDC_REDIRECT_URI`, `S3MINI_OIDC_AUDIENCE`, and `S3MINI_OIDC_ADMIN_EMAILS`. The `S3MINI_OIDC_*` client/provider names remain aliases.
- Distributed-storage design constraints and implementation phases are tracked in `docs/distributed-roadmap.md`; do not weaken its durability, convergence, or rolling-upgrade invariants.
- Replication delivery has a per-peer SQLite journal; do not prioritize quorum policy or other distributed-storage slices ahead of core S3 compatibility and single-node recovery.
- Update this handoff and `docs/project-status.md` when the next checkpoint changes.

## Security and Privacy

- Never commit credentials, access keys, signing secrets, private keys, tokens, or private deployment configuration.
- Use environment variables or local untracked configuration for secrets.
- Use placeholders in documentation and examples.
- Validate bucket names and object keys before filesystem operations.
- Do not weaken signature verification or authorization checks to make tests pass.

## Checkpoint Style

Use focused commit messages such as:

```text
feat: add AWS SDK multipart compatibility
fix: align DeleteObject status semantics
test: cover path-style SDK requests
docs: update compatibility status
```

Document remaining limitations rather than marking incomplete behavior as fully
compatible.
