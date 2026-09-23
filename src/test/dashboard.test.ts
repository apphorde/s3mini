import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerRoutes } from "../handlers/router.js";
import { S3Mini } from "../storage/s3mini.js";

describe("control-plane dashboard smoke test", () => {
  let app: ReturnType<typeof Fastify>;
  let s3: S3Mini;

  beforeEach(async () => {
    s3 = new S3Mini();
    await s3.init();
    app = Fastify();
    await registerRoutes(app, s3);
  });

  afterEach(async () => {
    await app.close();
    await s3.close();
  });

  it("boots the Li3 app shell with reactive bucket and policy views", async () => {
    const response = await app.inject({ method: "GET", url: "/admin" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<control-plane-app></control-plane-app>");
    expect(response.body).toContain('<template component="control-plane-app">');
    expect(response.body).toContain(
      "import { computed, ref, reactive, onInit } from '@li3/web';",
    );
    expect(response.body).toContain('template for="[bucket] of buckets"');
    expect(response.body).toContain("bucket-policy-dialog");
    expect(response.body).toContain('on-click="openPolicy(bucket.name)"');
    expect(response.body).toContain('on-click="setMenuOpen(true)"');
    expect(response.body).toContain('href="/admin/tailwind.css"');
    expect(response.body).not.toContain("document.querySelector");
    expect(response.body).not.toContain("innerHTML");
  });
});
