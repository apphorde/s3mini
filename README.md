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
`npm run test:auth-lab` is an opt-in integration smoke test requiring
`AUTH_LAB_KEY`, Docker, and Auth Lab access. It creates a temporary OIDC client,
issues scoped tokens, tests a disposable local container, and removes the
temporary client, container, image, and data directory in its cleanup path.

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
Logging defaults to `error`; set `LOG_LEVEL=info`, `debug`, or another Pino
level when request logging is needed.

S3MINI binds to `0.0.0.0:9000` by default. Docker still requires explicit port
publishing, for example:

```sh
docker run --rm -p 9000:9000 -v s3mini-data:/data your-s3mini-image
```

For VPN access, connect to the host address reachable through the VPN and make
sure the host firewall allows TCP `9000`. `EXPOSE 9000` alone does not publish
the port. Override the bind address or port with `S3MINI_HOST` and
`S3MINI_PORT` when needed.

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
can override the provider base URL. `S3MINI_OIDC_ADMIN_EMAILS` grants the listed
users the `admin` role. An unset or empty allowlist grants no configuration-based
admin role; authenticated users without an explicitly assigned role receive
HTTP 403 from `/admin`. Client secrets and allowlists must remain in environment
variables or local untracked config.

Only OIDC users explicitly assigned the `admin` role, or listed in
`S3MINI_OIDC_ADMIN_EMAILS`, can open `/admin` or call its management APIs.
Dashboard API tokens and the `s3:admin` scope do not substitute for this OIDC
admin designation. Roles are keyed by OIDC subject (`sub`), stored in SQLite,
and synchronized to configured replication peers. The legacy `viewer` and
`operator` labels are retained in stored records but do not grant dashboard
access. The email allowlist is an explicit admin grant; remove an email before
expecting its stored role to take effect.

The S3MINI server publishes the OpenAPI 3.0.3 specification for its implemented
S3, dashboard, OIDC, and replication APIs at `GET /api` as JSON. The source
document is `openapi-s3mini.json`.

S3MINI follows the provider's Node client flow: authorization-code PKCE uses
`/authorize` and `/token`, access tokens are verified as RS256 JWTs using
`/.well-known/jwks.json`, and user identity is loaded from `/userinfo` with
`X-Auth-Audience`.

Provider API tokens can call S3MINI with an `Authorization: Bearer` header.
Create them through the provider's `/api-tokens/{clientId}` endpoint and grant
only the scopes the integration needs:

```text
s3:read   GET, HEAD, and OPTIONS requests
s3:write  bucket/object mutations
s3:admin  S3 bucket policy/ACL/configuration operations (not `/admin`)
s3:provision account, S3-key, bucket, bucket-policy, and bucket-quota APIs only
```

`s3:provision` must be explicitly allowed for the S3MINI OIDC client at the
provider. It never grants dashboard, object-data, or replication access.
Provisioning is intended for a trusted service such as Filebin; that service
maintains the mapping from its OIDC users to S3MINI account IDs. Provisioned
accounts start with the `S3MINI_DEFAULT_ACCOUNT_QUOTA_BYTES` aggregate allocation
(default 10 GiB). Provisioning tokens can create accounts, issue/revoke
account-scoped S3 access keys, create/list/delete buckets, set policies on
account-owned buckets, and allocate per-bucket quotas. Bucket quota values are
bounded by the admin-controlled aggregate account quota. Existing buckets and
keys migrate to the isolated `legacy` account. S3MINI currently associates each
bucket and key with one account and enforces that mapping for data-plane
requests; the customer-facing bucket ownership and access-policy model remains
under design review.

S3MINI introspects opaque provider tokens through `/oauth/introspect`. Once
provisioned accounts exist, OIDC bearer tokens are not accepted for S3 object
data; use the account-scoped S3 keys returned by provisioning. Admins allocate
aggregate account quotas through `/admin/accounts/{accountId}/quota`; Filebin
allocates per-bucket quotas through its `s3:provision` endpoint (admins can also
set them through `/admin/buckets/{bucket}/quota`). Quota checks include stored object versions,
multipart part reservations, copies, and replicated object writes.

The dashboard requires an OIDC session with an explicit admin grant whenever
OIDC is configured. `S3MINI_ADMIN_TOKEN` remains available only for deployments
without OIDC and local testing.

OIDC admins can issue downstream API tokens from the dashboard's **OIDC tokens**
page. Configure `OIDC_API_TOKEN` on the S3MINI server with the OIDC provider's
client-bound token-minting API token for the S3MINI OIDC client. S3MINI sends it
only to the provider's `POST /api-tokens/{clientId}/issue` endpoint; it is never
sent to the browser or returned by S3MINI. The provider restricts minting to
that client and validates the requested scopes against its configured allowed
scopes. S3MINI limits requests to `s3:read`, `s3:write`, `s3:admin`, and
`s3:provision`. Generated opaque tokens are displayed once to the admin, so
copy and store them securely.

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
S3MINI_REPLICATION_INVENTORY_INTERVAL_MS=60000
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

Object-write delivery and delete delivery are event-driven. Inventory polling is
only anti-entropy repair and defaults to once per minute; tune it with
`S3MINI_REPLICATION_INVENTORY_INTERVAL_MS`. Reverse proxies should also exclude
`/internal/replication/inventory` from ordinary access logs if those logs are
not needed.

## Dashboard

Open `/admin` after authenticating with OIDC. The dashboard uses Li3 reactive
components, shows the current OIDC user in the sidebar, lists buckets and
access keys, edits bucket policies through a modal on the Buckets page, and lets
admins assign OIDC subject IDs to dashboard roles on the Users page. Bucket,
policy, and access-key actions operate on the current node; user roles converge
asynchronously across configured replicas and do not provide cluster consensus.

Set `S3MINI_REPLICATION_QUORUM` to a positive number to expose a degraded
state when fewer than that many configured peers are healthy. Current writes
remain asynchronous; quorum acknowledgement enforcement is intentionally
deferred while the project focuses on core S3 behavior and small deployments.
