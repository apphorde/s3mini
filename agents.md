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

## Current Handoff

- Latest pushed checkpoint: inspect the most recent commit on `main`.
- Verification baseline: 40 tests passing and `npm run build` passing.
- AWS SDK v3 coverage includes CRUD, pagination, multipart uploads, CopyObject,
  DeleteObjects, tagging, versioning, ranges, checksums, metadata, and conditionals.
- Next implementation slice: MinIO/Backblaze compatibility tests.
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
