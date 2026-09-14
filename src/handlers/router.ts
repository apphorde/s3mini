import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { FakeS3 } from '../storage/fakes3.js';
import { S3Error } from '../types/models.js';

export async function registerRoutes(fastify: FastifyInstance, s3: FakeS3) {
  fastify.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof S3Error) {
      reply.type('application/xml').code(error.httpCode).send(error.toResponseXml(request.id));
    } else {
      fastify.log.error(error);
      reply.type('application/xml').code(500).send(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>${error.message}</Message><RequestId>${request.id}</RequestId></Error>`);
    }
  });

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
    if (query.versioning !== undefined) {
      const body = String(request.body || '');
      const status = readXmlTag(body, 'Status') as 'Enabled' | 'Suspended' | undefined;
      if (!status) throw new S3Error('MalformedXML', 'Versioning status is required.', 400, params.bucket);
      await s3.putVersioning(params.bucket, status);
      return reply.code(200).send();
    }
    if (query.tagging !== undefined) {
      await s3.putBucketTags(params.bucket, parseTagXml(String(request.body || '')));
      return reply.code(200).send();
    }
    const configuration = configurationQuery(query);
    if (configuration) {
      await s3.putBucketConfiguration(params.bucket, configuration, parseJsonOrXml(String(request.body || '')));
      return reply.code(200).send();
    }
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
    const query = request.query as Record<string, string | undefined>;
    if (query.tagging !== undefined) {
      await s3.deleteBucketTags(params.bucket);
      return reply.code(204).send();
    }
    const configuration = configurationQuery(query);
    if (configuration) {
      await s3.deleteBucketConfiguration(params.bucket, configuration);
      return reply.code(204).send();
    }
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
    const copySource = request.headers['x-amz-copy-source'];
    if (copySource) {
      const source = decodeURIComponent(String(copySource)).replace(/^\//, '').split('/');
      const sourceBucket = source.shift();
      if (!sourceBucket || !source.length) throw new S3Error('InvalidRequest', 'x-amz-copy-source is invalid.', 400);
      const obj = await s3.copyObject(sourceBucket, source.join('/'), params.bucket, key);
      return reply.type('application/xml').code(200).send(wrapXml('CopyObjectResult', { ETag: obj.etag, LastModified: obj.lastModified.toISOString() }));
    }
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
    const original = await s3.getObject(params.bucket, key);
    const ifMatch = request.headers['if-match'];
    const ifNoneMatch = request.headers['if-none-match'];
    if (ifMatch && ifMatch !== '*' && !String(ifMatch).split(',').map(value => value.trim()).includes(original.metadata.etag)) {
      throw new S3Error('PreconditionFailed', 'At least one of the preconditions you specified did not hold.', 412, params.bucket, key);
    }
    if (ifNoneMatch && (ifNoneMatch === '*' || String(ifNoneMatch).split(',').map(value => value.trim()).includes(original.metadata.etag))) {
      return reply.code(304).header('ETag', original.metadata.etag).send();
    }
    let data = original.data;
    let metadata = original.metadata;
    let status = 200;
    const range = request.headers.range;
    let contentRange: string | undefined;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(String(range));
      if (!match) throw new S3Error('InvalidRange', 'The requested range is not satisfiable.', 416, params.bucket, key);
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : undefined;
      const ranged = await s3.getObjectRange(params.bucket, key, start, end);
      data = ranged.data;
      contentRange = `bytes ${start}-${start + data.length - 1}/${ranged.totalSize}`;
      status = 206;
    }

    reply.type(metadata.contentType || 'application/octet-stream')
      .header('ETag', metadata.etag)
      .header('Last-Modified', metadata.lastModified.toUTCString())
      .header('Accept-Ranges', 'bytes')
      .code(status);
    if (contentRange) reply.header('Content-Range', contentRange);
    reply.send(data);
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
    if (query.location !== undefined) {
      const location = await s3.getBucketLocation(params.bucket);
      return reply.type('application/xml').send(wrapXml('LocationConstraint', location));
    }
    if (query.versioning !== undefined) {
      const versioning = await s3.getVersioning(params.bucket);
      return reply.type('application/xml').send(wrapXml('VersioningConfiguration', versioning.status ? { Status: versioning.status } : {}));
    }
    if (query.tagging !== undefined) {
      const tags = await s3.getBucketTags(params.bucket);
      return reply.type('application/xml').send(wrapXml('Tagging', { TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) }));
    }
    const configuration = configurationQuery(query);
    if (configuration) {
      const value = await s3.getBucketConfiguration<Record<string, unknown>>(params.bucket, configuration);
      return reply.type('application/xml').send(wrapXml(configuration, value || {}));
    }
    const result = await s3.listObjectsV2Advanced({
      bucket: params.bucket,
      prefix: query.prefix,
      delimiter: query.delimiter,
      maxKeys: query['max-keys'] ? Number(query['max-keys']) : undefined,
      continuationToken: query['continuation-token'],
      startAfter: query['start-after'],
    });

    const response = {
      Name: params.bucket,
      Prefix: result.prefix,
      Delimiter: result.delimiter,
      MaxKeys: result.maxKeys,
      KeyCount: result.keyCount,
      IsTruncated: result.isTruncated,
      NextContinuationToken: result.nextContinuationToken,
      Contents: result.contents.map(c => ({
        Key: c.key, LastModified: c.lastModified.toISOString(), ETag: c.etag,
        Size: c.size, StorageClass: c.storageClass
      })),
      CommonPrefixes: result.commonPrefixes.map(Prefix => ({ Prefix })),
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
    if (typeof obj !== 'object' || obj === null) return escapeXml(String(obj));
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

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wrapXml(root: string, content: any): string {
  const body = toXml(content);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<' + root + '>\n' + body + '\n</' + root + '>';
}

function readXmlTag(body: string, tag: string): string | undefined {
  return body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
}

function parseTagXml(body: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const match of body.matchAll(/<Tag>\s*<Key>([^<]*)<\/Key>\s*<Value>([^<]*)<\/Value>\s*<\/Tag>/g)) tags[match[1]] = match[2];
  return tags;
}

function parseJsonOrXml(body: string): unknown {
  try { return JSON.parse(body); } catch { return { raw: body }; }
}

function configurationQuery(query: Record<string, string | undefined>): 'corsConfiguration' | 'lifecycleConfiguration' | 'policy' | 'encryptionConfiguration' | 'websiteConfiguration' | 'loggingStatus' | 'notificationConfiguration' | 'replicationConfiguration' | undefined {
  const map = {
    cors: 'corsConfiguration',
    lifecycle: 'lifecycleConfiguration',
    policy: 'policy',
    encryption: 'encryptionConfiguration',
    website: 'websiteConfiguration',
    logging: 'loggingStatus',
    notification: 'notificationConfiguration',
    replication: 'replicationConfiguration',
  } as const;
  const key = Object.keys(map).find(name => query[name] !== undefined) as keyof typeof map | undefined;
  return key ? map[key] : undefined;
}
