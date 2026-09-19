import fs from 'node:fs/promises';
import type { PeerHealthState, ReplicationEvent, ReplicationInventoryItem, S3Mini } from '../storage/s3mini.js';

export interface PeerHealth {
  peer: string;
  status: 'Healthy' | 'Unhealthy' | 'Unknown';
  consecutiveFailures: number;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
}

export class ReplicationWorker {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly peers: string[];
  private readonly token?: string;
  private readonly health = new Map<string, PeerHealth>();

  constructor(private readonly s3: S3Mini, options: { peers?: string[]; token?: string } = {}) {
    this.peers = options.peers || (process.env.S3MINI_REPLICATION_PEERS || '').split(',').map(peer => peer.trim()).filter(Boolean);
    this.token = options.token || process.env.S3MINI_REPLICATION_TOKEN;
    for (const peer of this.peers) this.health.set(peer, { peer, status: 'Unknown', consecutiveFailures: 0 });
  }

  start(intervalMs = 1000): void {
    if (this.timer || !this.peers.length || !this.token) return;
    void this.loadPersistedHealth();
    this.timer = setInterval(() => { void this.drainOnce(); }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getPeerHealth(): PeerHealth[] {
    return [...this.health.values()].map(item => ({ ...item }));
  }

  private async loadPersistedHealth(): Promise<void> {
    for (const state of await this.s3.listPeerHealth()) {
      if (this.health.has(state.peer)) this.health.set(state.peer, state);
    }
  }

  async drainOnce(): Promise<void> {
    if (this.running || !this.peers.length || !this.token) return;
    this.running = true;
    try {
      const now = Date.now();
      const events = (await this.s3.listReplicationEvents(100)).filter(event => event.status !== 'Delivered' && (!event.nextAttemptAt || event.nextAttemptAt.getTime() <= now));
      for (const event of events) await this.deliver(event);
      await this.repairMissingEvents(await this.s3.listReplicationEvents(1000));
    } finally {
      this.running = false;
    }
  }

  private async repairMissingEvents(events: ReplicationEvent[]): Promise<void> {
    for (const peer of this.peers) {
      try {
        const response = await fetch(`${peer.replace(/\/$/, '')}/internal/replication/inventory`, { headers: { 'x-s3mini-replication-token': this.token! } });
        if (!response.ok) {
          this.markPeerFailure(peer);
          continue;
        }
        this.markPeerSuccess(peer);
        const inventory = await response.json() as ReplicationInventoryItem[];
        const missing = events.filter(event => !inventory.some(item =>
          item.bucket === event.bucket && item.key === event.key && item.versionId === event.versionId &&
          item.deleteMarker === event.deleteMarker && (event.operation === 'DeleteObject' || item.etag === event.etag)
        ));
        for (const event of missing) await this.deliver(event, [peer], false);
      } catch {
        // The regular delivery retry path records failures; inventory is best effort.
        this.markPeerFailure(peer);
      }
    }
  }

  private async deliver(event: ReplicationEvent, peers = this.peers, updateStatus = true): Promise<void> {
    const attempts = event.attempts + 1;
    try {
      const body = event.operation === 'PutObject' ? await fs.readFile(event.payloadPath) : undefined;
      for (const peer of peers) {
        const response = await fetch(`${peer.replace(/\/$/, '')}/internal/replication`, {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            'x-s3mini-replication-token': this.token!,
            'x-s3mini-source-node': event.sourceNodeId,
            'x-s3mini-bucket': event.bucket,
            'x-s3mini-key': event.key,
            'x-s3mini-version-id': event.versionId,
            'x-s3mini-operation': event.operation,
            'x-s3mini-delete-marker': String(event.deleteMarker),
            'x-s3mini-etag': event.etag,
            'x-s3mini-last-modified': String(event.createdAt.getTime()),
          },
          body,
        });
        if (!response.ok) throw new Error(`Replication peer ${peer} returned HTTP ${response.status}.`);
        this.markPeerSuccess(peer);
      }
      if (updateStatus) await this.s3.updateReplicationEvent(event.id, 'Delivered', attempts);
    } catch {
      const delay = Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8));
      if (updateStatus) await this.s3.updateReplicationEvent(event.id, 'Failed', attempts, new Date(Date.now() + delay));
    }
  }

  private markPeerSuccess(peer: string): void {
    const state = { ...this.health.get(peer), peer, status: 'Healthy' as const, consecutiveFailures: 0, lastSuccessAt: new Date() };
    this.health.set(peer, state);
    void this.s3.savePeerHealth(state);
  }

  private markPeerFailure(peer: string): void {
    const current = this.health.get(peer);
    const state = { ...current, peer, status: 'Unhealthy' as const, consecutiveFailures: (current?.consecutiveFailures || 0) + 1, lastFailureAt: new Date() };
    this.health.set(peer, state);
    void this.s3.savePeerHealth(state);
  }
}
