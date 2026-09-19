import fs from 'node:fs/promises';
import type { ReplicationEvent, S3Mini } from '../storage/s3mini.js';

export class ReplicationWorker {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly peers: string[];
  private readonly token?: string;

  constructor(private readonly s3: S3Mini, options: { peers?: string[]; token?: string } = {}) {
    this.peers = options.peers || (process.env.S3MINI_REPLICATION_PEERS || '').split(',').map(peer => peer.trim()).filter(Boolean);
    this.token = options.token || process.env.S3MINI_REPLICATION_TOKEN;
  }

  start(intervalMs = 1000): void {
    if (this.timer || !this.peers.length || !this.token) return;
    this.timer = setInterval(() => { void this.drainOnce(); }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async drainOnce(): Promise<void> {
    if (this.running || !this.peers.length || !this.token) return;
    this.running = true;
    try {
      const now = Date.now();
      const events = (await this.s3.listReplicationEvents(100)).filter(event => event.status !== 'Delivered' && (!event.nextAttemptAt || event.nextAttemptAt.getTime() <= now));
      for (const event of events) await this.deliver(event);
    } finally {
      this.running = false;
    }
  }

  private async deliver(event: ReplicationEvent): Promise<void> {
    const attempts = event.attempts + 1;
    try {
      const body = await fs.readFile(event.payloadPath);
      for (const peer of this.peers) {
        const response = await fetch(`${peer.replace(/\/$/, '')}/internal/replication`, {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            'x-s3mini-replication-token': this.token!,
            'x-s3mini-source-node': event.sourceNodeId,
            'x-s3mini-bucket': event.bucket,
            'x-s3mini-key': event.key,
            'x-s3mini-version-id': event.versionId,
            'x-s3mini-etag': event.etag,
            'x-s3mini-last-modified': String(event.createdAt.getTime()),
          },
          body,
        });
        if (!response.ok) throw new Error(`Replication peer ${peer} returned HTTP ${response.status}.`);
      }
      await this.s3.updateReplicationEvent(event.id, 'Delivered', attempts);
    } catch {
      const delay = Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8));
      await this.s3.updateReplicationEvent(event.id, 'Failed', attempts, new Date(Date.now() + delay));
    }
  }
}
