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

## Replication Contract

The first network mode will be asynchronous replication. A client write is acknowledged after the local durable copy and journal transaction succeed; peer delivery does not add remote latency to the S3 request.

Replication identity is `(bucket, key, versionId, sourceNodeId)`. A peer must verify the payload size and ETag before acknowledging delivery. Retries must be idempotent and must never overwrite a different version ID.

Future peer communication must use authenticated TLS, a configured node identity, bounded retries, and backpressure. The journal is the handoff boundary between the S3 request path and that worker.

## Required Before HA Claims

- Replicate deletes and delete markers as durable tombstone events.
- Add peer registration, health, retry leasing, and dead-letter handling.
- Add anti-entropy scans to repair missed events and verify checksums.
- Define conflict handling for concurrent writes from different nodes.
- Add read-repair and an explicit consistency policy.
- Test disk-full, process crash, peer loss, clock skew, and partial network failure.

Until those pieces exist, S3MINI is durable on one node with replication intent recorded, but it is not yet a highly available or disaster-tolerant replacement for MinIO or Garage.
