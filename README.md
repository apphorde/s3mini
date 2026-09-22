# @cloud-cli/s3mini

Minimal S3-compatible object storage server in TypeScript.

## Usage

```sh
npm install @cloud-cli/s3mini
npm start
```

Build from source with `npm run build` and run the test suite with `npm test`.

See the repository documentation for configuration, S3 compatibility, replication, and administration.

New buckets default to the self-hosted `local` location. Explicit S3-compatible
location values remain supported when a deployment needs a region label.

## Dashboard OIDC

Set these environment variables to protect `/admin` with the OIDC provider at
`https://auth.api.apphor.de`:

Copy `.env.example` as a starting point for local configuration. Do not commit
the resulting `.env` file or any client secret.

```sh
S3MINI_OIDC_CLIENT_ID=your-client-id
S3MINI_OIDC_CLIENT_SECRET=your-client-secret
S3MINI_OIDC_REDIRECT_URI=https://storage.example.com/auth/callback
S3MINI_OIDC_AUDIENCE=your-client-id
S3MINI_OIDC_ADMIN_EMAILS=admin@example.com
```

The deployment may use the live provider names `AUTH_PROVIDER`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_REDIRECT_URI`; the
`S3MINI_OIDC_*` names remain supported as aliases. `AUTH_PROVIDER` may be the
provider origin or the `/api` documentation URL; both are normalized to the
OIDC endpoint origin.

Register the exact `/auth/callback` redirect URI with the OIDC client. `S3MINI_OIDC_AUTH_URL`
can override the provider base URL. The admin email allowlist is optional; when
omitted, any authenticated provider user is accepted. Client secrets and
allowlists must remain in environment variables or local untracked config.

S3MINI follows the provider's Node client flow: authorization-code PKCE uses
`/authorize` and `/token`, access tokens are verified as RS256 JWTs using
`/.well-known/jwks.json`, and user identity is loaded from `/userinfo` with
`X-Auth-Audience`.

Provider API tokens can also call S3MINI directly with an `Authorization:
Bearer` header. Create them through the provider's `/api-tokens/{clientId}`
endpoint and grant these scopes as needed:

```text
s3:read   GET, HEAD, and OPTIONS requests
s3:write  bucket/object mutations
s3:admin  bucket policy/ACL/configuration and `/admin` control-plane actions
```

Use `s3:*` for a full-access token. S3MINI introspects opaque provider tokens
through `/oauth/introspect` using the configured OIDC client credentials.

Set `S3MINI_REPLICATION_QUORUM` to a positive number to expose a degraded
state when fewer than that many configured peers are healthy. Current writes
remain asynchronous; quorum acknowledgement enforcement is intentionally
deferred while the project focuses on core S3 behavior and small deployments.
