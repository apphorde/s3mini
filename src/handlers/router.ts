import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import type { FakeS3 } from '../storage/fakes3';
import { S3Error } from '../types/models';

export async function registerRoutes(fastify: FastifyInstance, s3: FakeS3) {
  fastify.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof S3Error) {
      reply.type('application/xml').code(error.httpCode).send(error.toResponseXml(request.id));
    } else {
      fastify.log.error(error);
      reply.type('application/xml').code(500).send(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>${error.message}</Message><RequestId>${request.id}</RequestId></Error>`);
    }
  });

  await fastify.register(cors, { origin: '*' });

  // --- Bucket Operations ---

  async function listBuckets(request: FastifyRequest, reply: FastifyReply) {
    const buckets = await s3.listBuckets();
    const response = {
      Owner: { ID: '000000000000000000000000', DisplayName: 's3mini' },
      Buckets: buckets.map(b => ({ Name: b.name, CreationDate: b.creationDate.toISOString() }))
    };
    reply.type('application/xml').send(wrapXml('ListAllMyBucketsResult', response));
  }

  async function putBucket(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const query = request.query as Record<string, string | undefined>;
    await s3.createBucket(params.bucket, query.locationConstraint);
    reply.code(200).send();
  }

  async function headBucket(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    await s3.headBucket(params.bucket);
    reply.code(200).send();
  }

  async function deleteBucket(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    await s3.deleteBucket(params.bucket);
    reply.code(204).send();
  }

  fastify.get('/', listBuckets);
  fastify.put('/:bucket', putBucket);
  fastify.head('/:bucket', headBucket);
  fastify.delete('/:bucket', deleteBucket);

  // --- Object Operations ---

  async function putObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = (request.params as any)['*'] as string;
    const body = request.body as Buffer;

    const meta: any = {};
    if (request.headers['content-type']) meta.contentType = request.headers['content-type'];
    if (request.headers['content-disposition']) meta.contentDisposition = request.headers['content-disposition'];
    if (request.headers['content-encoding']) meta.contentEncoding = request.headers['content-encoding'];
    if (request.headers['cache-control']) meta.cacheControl = request.headers['cache-control'];
    if (request.headers['expires']) meta.expires = new Date(request.headers['expires']);

    const obj = await s3.putObject(params.bucket, key, body, meta);
    reply.type('application/xml').code(200).send(wrapXml('PutObjectResult', { ETag: obj.etag }));
  }

  async function getObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = (request.params as any)['*'] as string;
    const { data, metadata } = await s3.getObject(params.bucket, key);

    reply.type(metadata.contentType || 'application/octet-stream')
      .header('ETag', metadata.etag)
      .header('Last-Modified', metadata.lastModified.toUTCString())
      .send(data);
  }

  async function headObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = (request.params as any)['*'] as string;
    const { metadata } = await s3.getObject(params.bucket, key);

    reply.code(200)
      .header('ETag', metadata.etag)
      .header('Last-Modified', metadata.lastModified.toUTCString())
      .header('Content-Type', metadata.contentType)
      .send();
  }

  async function deleteObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = (request.params as any)['*'] as string;
    await s3.deleteObject(params.bucket, key);
    reply.code(204).send();
  }

  async function listObjectsV2(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const query = request.query as Record<string, string | undefined>;
    const contents = await s3.listObjectsV2(params.bucket, query.prefix);

    const response = {
      Name: params.bucket,
      IsTruncated: false,
      Contents: contents.map(c => ({
        Key: c.Key, LastModified: c.LastModified.toISOString(), ETag: c.ETag,
        Size: c.Size, StorageClass: c.StorageClass
      }))
    };
    reply.type('application/xml').send(wrapXml('ListObjectsV2Result', response));
  }

  fastify.put('/:bucket/*', putObject);
  fastify.get('/:bucket/*', getObject);
  fastify.head('/:bucket/*', headObject);
  fastify.delete('/:bucket/*', deleteObject);
  fastify.get('/:bucket', listObjectsV2);
}

function toXml(obj: any): string {
    if (typeof obj !== 'object' || obj === null) return String(obj);
    return Object.entries(obj).map(([key, val]) => {
        if (Array.isArray(val)) {
            return val.map(item => `<${key}>${toXml(item)}</${key}>`).join('');
        }
        if (typeof val === 'object') {
            return `<${key}>${toXml(val)}</${key}>`;
        }
        return '<' + key + '>' + String(val) + '</' + key + '>';
    }).join('\n');
}

function wrapXml(root: string, content: any): string {
  const body = toXml(content);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<' + root + '>\n' + body + '\n</' + root + '>';
}
