# Distributed Storage Roadmap

S3MINI is being evolved from a single-node S3-compatible server into a
durable, operator-controlled storage cluster for geographically distributed
deployments. The design prioritizes recoverability and observable degradation
over pretending that an unreachable peer is healthy.

## Guarantees

- A successful local write is durable before the client receives success.
- Replication intent is durable before the local write is acknowledged.
- Every replicated object is identified by bucket, key, immutable version, source
  node, ETag, and SHA-256 content digest.
- Delivery is idempotent and independently recoverable for every peer.
- Missing, divergent, and delayed peer state is observable and repairable.
- A network partition does not silently delete acknowledged local data.
- Destructive repair requires an explicit, authenticated operator action or a
  documented convergence rule.
- Schema and protocol changes remain readable by at least one previous release
  during rolling upgrades.

## Delivery Model

The target model is asynchronous replication with configurable durability
policy. A deployment may choose local-only acknowledgement, one remote copy,
or a quorum policy. Each peer has independent delivery state, retry schedule,
lease, checksum result, and dead-letter state. A global event status is only a
derived summary and is never the source of truth for repair. The SQLite
per-peer delivery journal and leases are now in place; quorum acknowledgement
and degraded-state reporting remain the next layer.

## Convergence Model

Objects use immutable versions. Nodes exchange compact inventories containing
version identity, logical timestamp, delete-marker state, size, ETag, and
SHA-256 digest. Repair proceeds in bounded pages and can resume after process
or network failure. Conflicts are resolved by a monotonic version ordering with
source-node tie-breaking; repair never overwrites a newer version with an older
one.

## Operational Phases

1. Per-peer delivery journal, quorum/degraded-state reporting, and durable
   leases.
2. Monotonic conflict ordering and resumable anti-entropy repair.
3. Encryption, key rotation, metrics, structured logs, readiness, and alerts.
4. Rolling migrations, backup/restore workflows, failure injection, and
   interoperability matrices against MinIO, Garage, AWS S3, and Backblaze B2.

## Non-Goals

S3MINI will not claim consensus, synchronous global durability, or automatic
conflict-free multi-master writes without an explicit deployment policy. The
system must expose these tradeoffs in its API and dashboard.
