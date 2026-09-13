import Fastify from 'fastify';
import cors from '@fastify/cors';
import { FakeS3 } from './storage/fakes3'
import { registerRoutes } from './handlers/router'

const fastify = Fastify({ 
  logger: true,
  bodyLimit: 100 * 1024 * 1024 
});

async function bootstrap() {
  const s3 = new FakeS3();
  await s3.init();

  await fastify.register(cors, {
    origin: '*',
  });

  await registerRoutes(fastify, s3);

  try {
    await fastify.listen({ port: 9000, host: '0.0.0.0' });
    console.log('S3MINI server listening on port 9000');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
