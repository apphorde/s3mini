import Fastify from "fastify";
import { S3Mini } from "./storage/s3mini.js";
import { registerRoutes } from "./handlers/router.js";
import { ReplicationWorker } from "./replication/worker.js";

const fastify = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024,
});

async function bootstrap() {
  const s3 = new S3Mini();
  await s3.init();
  const replication = new ReplicationWorker(s3);

  await registerRoutes(fastify, s3, replication);
  replication.start();
  fastify.addHook("onClose", async () => {
    replication.stop();
    await s3.close();
  });

  try {
    const port = Number(process.env.S3MINI_PORT || 9000);
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`S3MINI server listening on port ${port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
