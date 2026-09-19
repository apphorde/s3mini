# Distributed Architecture

S3MINI is being evolved toward an object store that can replicate data across
N independently located machines. The implementation is intentionally staged:
local durability comes before network replication, and network replication
comes before quorum or failover claims.

## Current Foundation

- SQLite metadata is stored in `/data/s3mini.sqlite` with WAL mode and full synchronous writes.
- Object and version files are written to a temporary sibling file, synced, and atomically renamed.
- Each successful `PutObject` creates a durable `replication_events` row in the same SQLite transaction as its object metadata.
- Events contain the bucket, key, immutable version ID, ETag, size, source node ID, and payload path.
- Events are initially `Pending` and expose explicit delivery status, attempt count, and retry time for a future worker.
- When `S3MINI_REPLICATION_PEERS` and `S3MINI_REPLICATION_TOKEN` are configured, a background worker sends pending object writes to each peer with exponential retry backoff.
- Peers accept writes only through the authenticated internal replication endpoint and do not create another outbound event.

## Replication Contract

The first network mode is asynchronous replication. For the initial geolocated test deployment, nodes may connect directly over private VPN endpoints; the VPN and network policy are responsible for reachability while S3MINI authenticates replication with its shared token. A client write is acknowledged after the local durable copy and journal transaction succeed; peer delivery does not add remote latency to the S3 request.

Replication identity is `(bucket, key, versionId, sourceNodeId)`. A peer must verify the payload size and ETag before acknowledging delivery. Retries must be idempotent and must never overwrite a different version ID.

Peer communication currently uses the configured internal URL and shared token; production deployments should place it behind authenticated TLS. The journal is the handoff boundary between the S3 request path and that worker.

## Required Before HA Claims

- Replicate deletes and delete markers as durable tombstone events. Delete delivery is now implemented, including idempotent version removal and delete-marker preservation.
- The authenticated `/internal/replication/inventory` endpoint exposes object-version fingerprints and tombstones; the worker compares this inventory and replays missing local journal events as best-effort anti-entropy repair.
- Add peer registration, health, retry leasing, and dead-letter handling.
- Add peer health state and checksum verification to strengthen anti-entropy repair.
- Define conflict handling for concurrent writes from different nodes.
- Add read-repair and an explicit consistency policy.
- Test disk-full, process crash, peer loss, clock skew, and partial network failure.

Until those pieces exist, S3MINI is durable on one node with asynchronous object-write replication, but it is not yet a highly available or disaster-tolerant replacement for MinIO or Garage.
