import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { ReplicationWorker } from "../replication/worker.js";
import { S3Mini } from "../storage/s3mini.js";

describe("ReplicationWorker", () => {
  let s3: S3Mini;
  const bucket = `worker-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  beforeEach(async () => {
    s3 = new S3Mini();
    await s3.init();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await s3.clearBucket(bucket);
    await s3.close();
  });

  it("delivers claimed events and records healthy peer state", async () => {
    await s3.createBucket(bucket);
    const object = await s3.putObject(
      bucket,
      "healthy.txt",
      Buffer.from("healthy"),
      {},
    );
    const fetchMock = vi.fn((input: string | URL, _init?: RequestInit) =>
      String(input).endsWith("/inventory")
        ? Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  bucket,
                  key: "healthy.txt",
                  versionId: object.versionId,
                  etag: object.etag,
                  sha256: crypto
                    .createHash("sha256")
                    .update("healthy")
                    .digest("hex"),
                  size: object.size,
                  lastModified: object.lastModified,
                  deleteMarker: false,
                },
              ]),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          )
        : Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const worker = new ReplicationWorker(s3, {
      peers: ["http://peer.test"],
      token: "token",
    });
    await worker.drainOnce();

    expect(
      (await s3.listReplicationEvents()).find(
        (event) => event.key === "healthy.txt",
      )?.status,
    ).toBe("Delivered");
    expect(worker.getPeerHealth()).toEqual([
      expect.objectContaining({
        peer: "http://peer.test",
        status: "Healthy",
        consecutiveFailures: 0,
      }),
    ]);
  });

  it("records failed delivery for retry and marks the peer unhealthy", async () => {
    await s3.createBucket(bucket);
    await s3.putObject(bucket, "failed.txt", Buffer.from("failed"), {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    const worker = new ReplicationWorker(s3, {
      peers: ["http://peer.test"],
      token: "token",
    });
    await worker.drainOnce();

    expect(
      (await s3.listReplicationEvents()).find(
        (event) => event.key === "failed.txt",
      ),
    ).toMatchObject({ status: "Failed", attempts: 1 });
    expect(worker.getPeerHealth()).toEqual([
      expect.objectContaining({
        peer: "http://peer.test",
        status: "Unhealthy",
        consecutiveFailures: 1,
      }),
    ]);
  });

  it("repairs an event missing from peer inventory", async () => {
    await s3.createBucket(bucket);
    const object = await s3.putObject(
      bucket,
      "repair.txt",
      Buffer.from("repair"),
      {},
    );
    const event = (await s3.listReplicationEvents()).find(
      (item) => item.key === "repair.txt",
    );
    await s3.ensureReplicationPeerEvents(["http://peer.test"]);
    await s3.updateReplicationPeerEvent(
      event!.id,
      "http://peer.test",
      "Delivered",
      1,
    );
    await s3.updateReplicationEvent(event!.id, "Delivered", 1);
    const fetchMock = vi.fn((input: string | URL, _init?: RequestInit) =>
      String(input).endsWith("/inventory")
        ? Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )
        : Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const worker = new ReplicationWorker(s3, {
      peers: ["http://peer.test"],
      token: "token",
    });
    await worker.drainOnce();

    const deliveryCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/internal/replication"),
    );
    expect(deliveryCall?.[0]).toBe("http://peer.test/internal/replication");
    expect(
      (deliveryCall?.[1]?.headers as Record<string, string>)?.[
        "x-s3mini-sha256"
      ],
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(object.versionId).toBeTruthy();
  });
});
