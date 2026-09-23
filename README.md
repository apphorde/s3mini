# @cloud-cli/s3mini

Minimal S3-compatible object storage server in TypeScript.

## Usage

```sh
npm install @cloud-cli/s3mini
npm start
```

Build from source with `npm run build` and run the test suite with `npm test`.
The dashboard smoke test runs without OIDC by using a test-only static admin
token: `npm run test:ui`. It starts an isolated local server automatically.

See the repository documentation for configuration, S3 compatibility, replication, and administration.

New buckets default to the self-hosted `local` location. AWS-compatible and
custom self-hosted labels such as `ams` and `ind` are accepted. Location is the
bucket's logical S3 region, not a replica machine name; use `S3MINI_NODE_ID` to
identify machines.

## Single-Node Setup

Copy `.env.example`, set the OIDC client values, and run:

```sh
npm run build
npm start
```

The S3 endpoint is `http://localhost:9000`. The default metadata database and
object files live under `/data`; use a persistent volume for that directory.
Configure S3 clients with path-style addressing and `region: local`.

## Dashboard OIDC

Set these environment variables to protect `/admin` with your OIDC provider:

Copy `.env.example` as a starting point for local configuration. Do not commit
the resulting `.env` file or any client secret.

```sh
AUTH_PROVIDER=https://auth.example.com
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
can override the provider base URL. An explicit admin email allowlist is
required for OIDC browser administration; when it is omitted, authenticated
provider users are not admins. Client secrets and allowlists must remain in
environment variables or local untracked config.

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

The dashboard does not require an API token when the browser has an OIDC
session and its email is listed in `S3MINI_OIDC_ADMIN_EMAILS`. The optional
`S3MINI_ADMIN_TOKEN` is intended for local/testing or non-OIDC deployments.

## Replica Setup

Run the same S3MINI image or build on every machine. Each machine must have:

- Its own persistent `/data` volume
- A unique `S3MINI_NODE_ID`
- The same private `S3MINI_REPLICATION_TOKEN`
- Peer URLs in `S3MINI_REPLICATION_PEERS`
- Network reachability over a private network or authenticated TLS proxy

Example for node A:

```env
S3MINI_REGION=local
S3MINI_NODE_ID=node-a
S3MINI_REPLICATION_PEERS=https://node-b.example.internal:9000,https://node-c.example.internal:9000
S3MINI_REPLICATION_TOKEN=replace-with-a-long-random-secret
S3MINI_REPLICATION_QUORUM=0
```

Node B uses the same service and token, but a different `S3MINI_NODE_ID` and
peer list. Replication is asynchronous: a request is acknowledged after the
local SQLite transaction and object file are durable. Peer delivery, health,
inventory repair, leases, and dead letters are visible in the dashboard.

The current dashboard is node-local. It does not aggregate bucket contents or
capacity across replicas. Quorum acknowledgement, conflict resolution, and
failover are not yet enabled. A bucket replicated between nodes should use the
same logical location label on each node; the label does not need to equal the
node ID.

## Dashboard

Open `/admin` after authenticating with OIDC. The dashboard uses Li3 reactive
components, shows the current OIDC user in the sidebar, lists buckets and
access keys, and edits bucket policies through a modal on the Buckets page.
The account and policy actions operate on the current node.

Set `S3MINI_REPLICATION_QUORUM` to a positive number to expose a degraded
state when fewer than that many configured peers are healthy. Current writes
remain asynchronous; quorum acknowledgement enforcement is intentionally
deferred while the project focuses on core S3 behavior and small deployments.
