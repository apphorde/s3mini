import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import type { FakeS3 } from '../storage/fakes3.js';
import { S3Error } from '../types/models.js';
import { verifyPresignedSigV4, verifySigV4 } from '../auth/sigv4.js';

export async function registerRoutes(fastify: FastifyInstance, s3: FakeS3) {
  fastify.addContentTypeParser(['application/octet-stream', 'application/xml', 'text/xml', 'text/csv'], { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  fastify.addHook('preValidation', async (request) => {
    const authorization = request.headers.authorization;
    const hasPresign = new URL(request.raw.url || '/', 'http://localhost').searchParams.has('X-Amz-Algorithm');
    const accessKeyId = process.env.S3MINI_ACCESS_KEY;
    const secretAccessKey = process.env.S3MINI_SECRET_KEY;
    if (hasPresign && (!accessKeyId || !secretAccessKey || !verifyPresignedSigV4({ method: request.method, url: request.raw.url || '/', headers: request.headers, body: Buffer.isBuffer(request.body) ? request.body : undefined }, { accessKeyId: accessKeyId || '', secretAccessKey: secretAccessKey || '', region: process.env.S3MINI_REGION || 'us-east-1' }))) {
      throw new S3Error('SignatureDoesNotMatch', 'The presigned URL signature does not match.', 403);
    }
    if (authorization && (!accessKeyId || !secretAccessKey || !verifySigV4({ method: request.method, url: request.raw.url || '/', headers: request.headers, body: Buffer.isBuffer(request.body) ? request.body : undefined }, { accessKeyId: accessKeyId || '', secretAccessKey: secretAccessKey || '', region: process.env.S3MINI_REGION || 'us-east-1' }))) {
      throw new S3Error('SignatureDoesNotMatch', 'The request signature does not match.', 403);
    }
    const params = request.params as { bucket?: string; '*': string };
    const query = request.query as Record<string, string | undefined>;
    const key = params['*'] ? normalizeObjectKey(params['*']) : undefined;
    if (params.bucket && !query.policy && !query.acl && (key || request.method !== 'PUT')) {
      const action = key ? `${request.method === 'GET' ? 'Get' : request.method === 'PUT' ? 'Put' : request.method === 'DELETE' ? 'Delete' : request.method}Object` : request.method === 'GET' ? 'ListBucket' : `${request.method}Bucket`;
      if (await s3.isRequestDenied(params.bucket, key, `s3:${action}`)) throw new S3Error('AccessDenied', 'Access denied by bucket policy.', 403, params.bucket, key);
    }
  });
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
      const tags = parseTagXml(String(request.body || ''));
      await s3.putBucketTags(params.bucket, tags);
      return reply.code(200).send();
    }
    const configuration = configurationQuery(query);
    if (configuration) {
      await s3.putBucketConfiguration(params.bucket, configuration, parseJsonOrXml(request.body));
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

  fastify.get('/', { exposeHeadRoute: false }, listBuckets);
  fastify.put('/:bucket', putBucket);
  fastify.head('/:bucket', headBucket);
  fastify.delete('/:bucket', deleteBucket);

  fastify.options('/:bucket/*', async (request, reply) => {
    const params = request.params as { bucket: string };
    const origin = request.headers.origin;
    const requestedMethod = request.headers['access-control-request-method'];
    const requestedHeaders = request.headers['access-control-request-headers'];
    const configuration = await s3.getBucketConfiguration<{ rules?: Array<Record<string, unknown>> }>(params.bucket, 'corsConfiguration');
    const rule = configuration?.rules?.find(candidate => {
      const origins = Array.isArray(candidate.allowedOrigins) ? candidate.allowedOrigins : [];
      const methods = Array.isArray(candidate.allowedMethods) ? candidate.allowedMethods : [];
      return !!origin && (origins.includes('*') || origins.includes(origin)) && (!requestedMethod || methods.includes(String(requestedMethod)));
    });
    if (!rule) throw new S3Error('AccessDenied', 'CORS request is not allowed.', 403, params.bucket);
    const origins = Array.isArray(rule.allowedOrigins) ? rule.allowedOrigins : [];
    const methods = Array.isArray(rule.allowedMethods) ? rule.allowedMethods : [];
    const allowedHeaders = Array.isArray(rule.allowedHeaders) ? rule.allowedHeaders : [];
    return reply.code(204)
      .header('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin as string)
      .header('Access-Control-Allow-Methods', methods.join(','))
      .header('Access-Control-Allow-Headers', requestedHeaders || allowedHeaders.join(','))
      .header('Access-Control-Max-Age', String(rule.maxAgeSeconds || 0))
      .send();
  });

  // --- Object Operations ---

  async function putObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = normalizeObjectKey((request.params as any)['*'] as string);
    const query = request.query as Record<string, string | undefined>;
    if (!key) {
      if (query.versioning !== undefined || query.tagging !== undefined || configurationQuery(query)) return putBucket(request, reply);
      await s3.createBucket(params.bucket, query.locationConstraint);
      return reply.code(200).send();
    }
    if (query.uploadId && query.partNumber) {
      const copySource = request.headers['x-amz-copy-source'];
      if (copySource) {
        const source = decodeURIComponent(String(copySource)).replace(/^\//, '').split('/');
        const sourceBucket = source.shift();
        if (!sourceBucket || !source.length) throw new S3Error('InvalidRequest', 'x-amz-copy-source is invalid.', 400, params.bucket, key);
        const part = await s3.uploadPartCopy(params.bucket, key, query.uploadId, Number(query.partNumber), sourceBucket, source.join('/'));
        return reply.type('application/xml').code(200).send(wrapXml('CopyPartResult', { ETag: part.etag, LastModified: part.lastModified.toISOString() }));
      }
      const part = await s3.uploadPart({ bucket: params.bucket, key, uploadId: query.uploadId, partNumber: Number(query.partNumber), body: request.body as Buffer });
      return reply.code(200).header('ETag', part.etag).send();
    }
    if (query.tagging !== undefined) {
      await s3.putObjectTags(params.bucket, key, parseTagXml(String(request.body || '')), query.versionId);
      return reply.code(200).send();
    }
    if (query.acl !== undefined) {
      const canned = request.headers['x-amz-acl'] || readXmlTag(String(request.body || ''), 'CannedACL') || 'private';
      await s3.putObjectAcl(params.bucket, key, { CannedACL: canned }, query.versionId);
      return reply.code(200).send();
    }
    const copySource = request.headers['x-amz-copy-source'];
    if (copySource) {
      const source = decodeURIComponent(String(copySource)).replace(/^\//, '').split('/');
      const sourceBucket = source.shift();
      if (!sourceBucket || !source.length) throw new S3Error('InvalidRequest', 'x-amz-copy-source is invalid.', 400);
      const obj = await s3.copyObject(sourceBucket, source.join('/'), params.bucket, key);
      return reply.type('application/xml').code(200).send(wrapXml('CopyObjectResult', { ETag: obj.etag, LastModified: obj.lastModified.toISOString() }));
    }
    const body = request.body as Buffer;
    const checksum = request.headers['x-amz-checksum-sha256'];
    const checksumSha256 = crypto.createHash('sha256').update(body).digest('base64');
    if (checksum && checksum !== checksumSha256) {
      throw new S3Error('BadDigest', 'The SHA-256 checksum did not match the request body.', 400, params.bucket, key);
    }

    const meta: any = {};
    if (request.headers['content-type']) meta.contentType = request.headers['content-type'];
    if (request.headers['content-disposition']) meta.contentDisposition = request.headers['content-disposition'];
    if (request.headers['content-encoding']) meta.contentEncoding = request.headers['content-encoding'];
    if (request.headers['cache-control']) meta.cacheControl = request.headers['cache-control'];
    if (request.headers['expires']) meta.expires = new Date(request.headers['expires']);
    meta.userMetadata = Object.fromEntries(Object.entries(request.headers)
      .filter(([name]) => name.toLowerCase().startsWith('x-amz-meta-'))
      .map(([name, value]) => [name.slice('x-amz-meta-'.length).toLowerCase(), Array.isArray(value) ? value.join(',') : String(value)]));
    const encryption = request.headers['x-amz-server-side-encryption'];
    const kmsKeyId = request.headers['x-amz-server-side-encryption-aws-kms-key-id'];
    if (encryption && encryption !== 'AES256' && encryption !== 'aws:kms') {
      throw new S3Error('InvalidEncryptionAlgorithmError', 'The requested encryption algorithm is not supported.', 400, params.bucket, key);
    }
    if (encryption === 'aws:kms' && !kmsKeyId) {
      throw new S3Error('InvalidRequest', 'A KMS key identifier is required for aws:kms encryption.', 400, params.bucket, key);
    }
    if (encryption) meta.serverSideEncryption = encryption;
    if (kmsKeyId) meta.sseKmsKeyId = kmsKeyId;
    const lockMode = request.headers['x-amz-object-lock-mode'];
    const retainUntil = request.headers['x-amz-object-lock-retain-until-date'];
    const legalHold = request.headers['x-amz-object-lock-legal-hold'];
    if (lockMode && lockMode !== 'GOVERNANCE' && lockMode !== 'COMPLIANCE') throw new S3Error('InvalidRequest', 'Unsupported object lock mode.', 400, params.bucket, key);
    if (retainUntil && Number.isNaN(Date.parse(String(retainUntil)))) throw new S3Error('InvalidRequest', 'Invalid retention date.', 400, params.bucket, key);
    if (legalHold && legalHold !== 'ON' && legalHold !== 'OFF') throw new S3Error('InvalidRequest', 'Invalid legal hold status.', 400, params.bucket, key);
    if (lockMode) meta.objectLockMode = lockMode;
    if (retainUntil) meta.retainUntil = new Date(String(retainUntil));
    if (legalHold) meta.legalHold = legalHold;

    const obj = await s3.putObject(params.bucket, key, body, meta);
    reply.type('application/xml').code(200).header('x-amz-checksum-sha256', checksumSha256).send(wrapXml('PutObjectResult', { ETag: obj.etag, ChecksumSHA256: checksumSha256 }));
  }

  async function getObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = normalizeObjectKey((request.params as any)['*'] as string);
    const query = request.query as Record<string, string | undefined>;
    if (!key) return listObjectsV2(request, reply);
    if (query.uploadId && !query.tagging) {
      const parts = await s3.listParts({ bucket: params.bucket, key, uploadId: query.uploadId, partNumberMarker: query['part-number-marker'] ? Number(query['part-number-marker']) : undefined });
      return reply.type('application/xml').send(wrapXml('ListPartsResult', {
        Bucket: parts.bucket,
        Key: parts.key,
        UploadId: parts.uploadId,
        IsTruncated: parts.isTruncated,
        Parts: parts.parts.map(part => ({ PartNumber: part.partNumber, ETag: part.etag, Size: part.size, LastModified: part.lastModified.toISOString() })),
      }));
    }
    if (query.tagging !== undefined) {
      const tags = await s3.getObjectTags(params.bucket, key, query.versionId);
      return reply.type('application/xml').send(wrapXml('Tagging', { TagSet: { Tag: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) } }));
    }
    if (query.acl !== undefined) {
      const acl = await s3.getObjectAcl<Record<string, unknown>>(params.bucket, key, query.versionId);
      return reply.type('application/xml').send(wrapXml('AccessControlPolicy', acl));
    }
    const original = await s3.getObject(params.bucket, key, query.versionId);
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
    let checksumSha256 = crypto.createHash('sha256').update(original.data).digest('base64');
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
      checksumSha256 = crypto.createHash('sha256').update(data).digest('base64');
      status = 206;
    }

    reply.type(metadata.contentType || 'application/octet-stream')
      .header('ETag', metadata.etag)
      .header('Last-Modified', metadata.lastModified.toUTCString())
      .header('Content-Length', String(data.length))
      .header('Cache-Control', metadata.cacheControl || '')
      .header('Content-Disposition', metadata.contentDisposition || '')
      .header('Content-Encoding', metadata.contentEncoding || '')
      .header('x-amz-checksum-sha256', checksumSha256)
      .header('Accept-Ranges', 'bytes')
      .code(status);
    if (metadata.serverSideEncryption) reply.header('x-amz-server-side-encryption', metadata.serverSideEncryption);
    if (metadata.sseKmsKeyId) reply.header('x-amz-server-side-encryption-aws-kms-key-id', metadata.sseKmsKeyId);
    if (metadata.objectLockMode) reply.header('x-amz-object-lock-mode', metadata.objectLockMode);
    if (metadata.objectLockRetainUntilDate) reply.header('x-amz-object-lock-retain-until-date', metadata.objectLockRetainUntilDate.toUTCString());
    if (metadata.objectLockLegalHold !== undefined) reply.header('x-amz-object-lock-legal-hold', metadata.objectLockLegalHold ? 'ON' : 'OFF');
    for (const [name, value] of Object.entries(metadata.userMetadata)) reply.header(`x-amz-meta-${name}`, value);
    if (contentRange) reply.header('Content-Range', contentRange);
    reply.send(data);
  }

  async function headObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = normalizeObjectKey((request.params as any)['*'] as string);
    if (!key) return headBucket(request, reply);
    const query = request.query as Record<string, string | undefined>;
    const { metadata } = await s3.getObject(params.bucket, key, query.versionId);

    reply.code(200)
      .header('ETag', metadata.etag)
      .header('Last-Modified', metadata.lastModified.toUTCString())
      .header('Content-Type', metadata.contentType)
      .header('Content-Length', String(metadata.size))
      .header('Cache-Control', metadata.cacheControl || '')
      .header('Content-Disposition', metadata.contentDisposition || '')
      .header('Content-Encoding', metadata.contentEncoding || '')
      .header('x-amz-checksum-sha256', crypto.createHash('sha256').update((await s3.getObject(params.bucket, key)).data).digest('base64'));
    if (metadata.serverSideEncryption) reply.header('x-amz-server-side-encryption', metadata.serverSideEncryption);
    if (metadata.sseKmsKeyId) reply.header('x-amz-server-side-encryption-aws-kms-key-id', metadata.sseKmsKeyId);
    if (metadata.objectLockMode) reply.header('x-amz-object-lock-mode', metadata.objectLockMode);
    if (metadata.objectLockRetainUntilDate) reply.header('x-amz-object-lock-retain-until-date', metadata.objectLockRetainUntilDate.toUTCString());
    if (metadata.objectLockLegalHold !== undefined) reply.header('x-amz-object-lock-legal-hold', metadata.objectLockLegalHold ? 'ON' : 'OFF');
    for (const [name, value] of Object.entries(metadata.userMetadata)) reply.header(`x-amz-meta-${name}`, value);
    reply.send();
  }

  async function deleteObject(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const key = normalizeObjectKey((request.params as any)['*'] as string);
    const query = request.query as Record<string, string | undefined>;
    if (!key) return deleteBucket(request, reply);
    if (query.uploadId) {
      await s3.abortMultipartUpload(params.bucket, key, query.uploadId);
      return reply.code(204).send();
    }
    if (query.tagging !== undefined) {
      await s3.deleteObjectTags(params.bucket, key, query.versionId);
      return reply.code(204).send();
    }
    if (query.versionId) {
      await s3.deleteObjectVersion(params.bucket, key, query.versionId);
      return reply.code(204).send();
    }
    try {
      await s3.deleteObject(params.bucket, key);
    } catch (error) {
      if (!(error instanceof S3Error) || error.code !== 'NoSuchKey') throw error;
    }
    reply.code(204).send();
  }

  async function listObjectsV2(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { bucket: string };
    const query = request.query as Record<string, string | undefined>;
    if (query.versions !== undefined) {
      const versions = await s3.listObjectVersions(params.bucket, query.prefix);
      return reply.type('application/xml').send(wrapXml('ListVersionsResult', {
        Name: params.bucket,
        Versions: versions.map(version => ({
          Key: version.Key,
          VersionId: version.VersionId,
          IsLatest: version.IsLatest,
          IsDeleteMarker: version.IsDeleteMarker,
          LastModified: version.LastModified.toISOString(),
          ETag: version.ETag,
          Size: version.Size,
          StorageClass: version.StorageClass,
        })),
      }));
    }
    if (query.uploads !== undefined) {
      const result = await s3.listMultipartUploads({ bucket: params.bucket, prefix: query.prefix, maxUploads: query['max-uploads'] ? Number(query['max-uploads']) : undefined });
      return reply.type('application/xml').send(wrapXml('ListMultipartUploadsResult', {
        Bucket: result.bucket,
        Uploads: result.uploads.map(upload => ({ Key: upload.key, UploadId: upload.uploadId, Initiated: upload.initiated.toISOString(), StorageClass: upload.storageClass })),
      }));
    }
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
      return reply.type('application/xml').send(wrapXml('Tagging', { TagSet: { Tag: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) } }));
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
  fastify.post('/:bucket/*', async (request, reply) => {
    const params = request.params as { bucket: string };
    const key = normalizeObjectKey((request.params as any)['*'] as string);
    const query = request.query as Record<string, string | undefined>;
    if (query.restore !== undefined) {
      await s3.restoreObject(params.bucket, key);
      return reply.code(202).header('x-amz-restore', 'ongoing-request="false"').send();
    }
    if (query.select !== undefined) {
      const expression = readXmlTag(String(request.body || ''), 'Expression') || 'SELECT * FROM S3Object';
      const body = await s3.selectObjectContent(params.bucket, key, expression);
      return reply.type('application/octet-stream').send(body);
    }
    if (query.uploads !== undefined) {
      const result = await s3.createMultipartUpload(params.bucket, key);
      return reply.type('application/xml').send(wrapXml('InitiateMultipartUploadResult', { Bucket: result.bucket, Key: result.key, UploadId: result.uploadId }));
    }
    if (!query.uploadId) throw new S3Error('InvalidRequest', 'uploadId is required.', 400, params.bucket, key);
    const parts = [...String(request.body || '').matchAll(/<Part\b[^>]*>([\s\S]*?)<\/Part>/g)]
      .map(match => ({ partNumber: Number(readXmlTag(match[1], 'PartNumber')), etag: unescapeXml(readXmlTag(match[1], 'ETag') || '') }))
      .filter(part => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag);
    const result = await s3.completeMultipartUpload({ bucket: params.bucket, key, uploadId: query.uploadId, parts });
    reply.type('application/xml').send(wrapXml('CompleteMultipartUploadResult', { Bucket: result.bucket, Key: result.key, ETag: result.etag }));
  });
  fastify.get('/:bucket/*', { exposeHeadRoute: false }, getObject);
  fastify.head('/:bucket/*', headObject);
  fastify.delete('/:bucket/*', deleteObject);
  fastify.get('/:bucket', { exposeHeadRoute: false }, listObjectsV2);
}

function toXml(obj: any): string {
    if (typeof obj !== 'object' || obj === null) return escapeXml(String(obj));
    return Object.entries(obj).filter(([, val]) => val !== undefined && val !== null).map(([key, val]) => {
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

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function normalizeObjectKey(key: string): string {
  return key.replace(/^\/+/, '');
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
  for (const match of body.matchAll(/<Tag\b[^>]*>\s*<Key>([^<]*)<\/Key>\s*<Value>([^<]*)<\/Value>\s*<\/Tag>/g)) tags[match[1]] = match[2];
  return tags;
}

function parseJsonOrXml(body: unknown): unknown {
  if (typeof body === 'object' && body !== null) return body;
  const text = String(body || '');
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function configurationQuery(query: Record<string, string | undefined>): 'corsConfiguration' | 'lifecycleConfiguration' | 'policy' | 'encryptionConfiguration' | 'websiteConfiguration' | 'loggingStatus' | 'notificationConfiguration' | 'replicationConfiguration' | 'acl' | undefined {
  const map = {
    cors: 'corsConfiguration',
    lifecycle: 'lifecycleConfiguration',
    policy: 'policy',
    encryption: 'encryptionConfiguration',
    website: 'websiteConfiguration',
    logging: 'loggingStatus',
    notification: 'notificationConfiguration',
    replication: 'replicationConfiguration',
    acl: 'acl',
  } as const;
  const key = Object.keys(map).find(name => query[name] !== undefined) as keyof typeof map | undefined;
  return key ? map[key] : undefined;
}
