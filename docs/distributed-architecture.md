# Distributed Architecture

S3MINI is being evolved toward an object store that can replicate data across
N independently located machines. The implementation is intentionally staged:
local durability comes before network replication, and network replication
comes before quorum or failover claims.

This is a secondary scale path, not a prerequisite for the core S3 service.
Single-node correctness, recovery, and common-client interoperability take
priority over completing high-availability behavior.

Every replica runs the same S3MINI service with its own `/data` volume and
SQLite database. `S3MINI_NODE_ID` identifies the source of a version, while
`S3MINI_REPLICATION_PEERS` and `S3MINI_REPLICATION_TOKEN` configure outbound
delivery. Bucket location is a logical S3 region label and is not a machine
placement list.

## Current Foundation

- SQLite metadata is stored in `/data/s3mini.sqlite` with WAL mode and full synchronous writes.
- Object and version files are written to a temporary sibling file, synced, and atomically renamed.
- Each successful `PutObject` creates a durable `replication_events` row in the same SQLite transaction as its object metadata.
- Events contain the bucket, key, immutable version ID, ETag, size, source node ID, and payload path.
- Events are initially `Pending` and expose explicit delivery status, attempt count, and retry time for the background worker.
- When `S3MINI_REPLICATION_PEERS` and `S3MINI_REPLICATION_TOKEN` are configured, a background worker sends pending object writes to each peer with exponential retry backoff.
- Object and delete-event delivery runs on the short worker interval; anti-entropy inventory checks run separately and default to once per minute through `S3MINI_REPLICATION_INVENTORY_INTERVAL_MS`.
- Peers accept writes only through the authenticated internal replication endpoint and do not create another outbound event.

## Replication Contract

The first network mode is asynchronous replication. For the initial geolocated test deployment, nodes may connect directly over private VPN endpoints; the VPN and network policy are responsible for reachability while S3MINI authenticates replication with its shared token. A client write is acknowledged after the local durable copy and journal transaction succeed; peer delivery does not add remote latency to the S3 request.

Replication identity is `(bucket, key, versionId, sourceNodeId)`. A peer must verify the payload size and ETag before acknowledging delivery. Retries must be idempotent and must never overwrite a different version ID.

Peer communication currently uses the configured internal URL and shared token; production deployments should place it behind authenticated TLS. The journal is the handoff boundary between the S3 request path and that worker.

Container deployments must publish TCP port `9000` to the host or use host
networking. The service binds to `0.0.0.0` by default; a VPN client should use
the host's VPN-reachable address, not the container's private bridge address.

## Current Replication State

- Replication of deletes and delete markers is implemented, including
  idempotent version removal and delete-marker preservation.
- The authenticated `/internal/replication/inventory` endpoint exposes object-version fingerprints and tombstones; the worker compares this inventory and replays missing local journal events as best-effort anti-entropy repair.
- Replication events use SQLite leases with expiry so concurrent workers do not deliver the same event simultaneously, and crashed workers can be recovered; exhausted events move to a durable dead-letter state and can be requeued by an admin. New replication deliveries carry and validate a SHA-256 body digest in addition to the ETag.
- Peer health is persisted in SQLite and exposed through the admin control plane; PUT delivery validates MD5 ETags and SHA-256 digests, and inventory repair compares SHA-256 digests with an ETag fallback for legacy events.
- OIDC dashboard role assignments (`viewer`, `operator`, `admin`, and revocation tombstones) are stored in SQLite and synchronized to each configured peer during anti-entropy repair. Role updates use last-write-wins ordering by update timestamp and source node ID; this is eventual replication, not consensus or an atomic cluster-wide authorization change.

## Deferred Before HA Claims

- Define conflict handling for concurrent writes from different nodes.
- Add read-repair and an explicit consistency policy.
- Test disk-full, process crash, peer loss, clock skew, and partial network failure.

Until those pieces exist, S3MINI is durable on one node with asynchronous object-write replication, but it is not yet a highly available or disaster-tolerant replacement for MinIO or Garage.
