# Multi-tenant provisioning and quota work

- [x] Restrict dashboard pages/APIs to explicitly designated OIDC admins; retain the email allowlist as an explicit admin grant.
- [x] Add an admin-only one-time token issuance UI backed by the OIDC provider's client-bound bearer API. Token listing and revocation remain provider-session-only operations and are not exposed in S3MINI.
- [x] Enforce the dedicated `s3:provision` scope only on provisioning APIs; do not treat it as admin, S3 data-plane, or replication access.
- [x] Add storage-account records, external identity references, account-scoped key lifecycle, and account-owned buckets.
- [x] Enforce account isolation on bucket listing and S3 bucket/object operations; migration assigns existing records to `legacy`.
- [x] Add account/bucket quota APIs and enforce limits atomically for object writes, multipart part reservations, copies, and replicated object writes.
- [x] Update the OpenAPI contract, user/admin documentation, account allocation UI, and authorization/isolation/quota tests.
- [x] Verify formatting, lint/type checks, tests, and package/build locally.
- [x] Verify CI and deployment behavior after push; the latest Docker/NPM jobs passed and the deployed `/api` endpoint returned HTTP 200.
