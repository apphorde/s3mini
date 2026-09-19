import Fastify from 'fastify';
import { S3Mini } from './storage/s3mini.js';
import { registerRoutes } from './handlers/router.js';
import { ReplicationWorker } from './replication/worker.js';

const fastify = Fastify({ 
  logger: true,
  bodyLimit: 100 * 1024 * 1024 
});

async function bootstrap() {
  const s3 = new S3Mini();
  await s3.init();

  await registerRoutes(fastify, s3);
  const replication = new ReplicationWorker(s3);
  replication.start();
  fastify.addHook('onClose', async () => {
    replication.stop();
    await s3.close();
  });

  try {
    await fastify.listen({ port: 9000, host: '0.0.0.0' });
    console.log('S3MINI server listening on port 9000');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
