import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import type { S3Mini } from '../storage/s3mini.js';
import { S3Error, VALID_STORAGE_CLASSES } from '../types/models.js';
import { verifyPresignedSigV4, verifySigV4 } from '../auth/sigv4.js';
import type { ReplicationWorker } from '../replication/worker.js';

export async function registerRoutes(fastify: FastifyInstance, s3: S3Mini, replication?: ReplicationWorker) {
  fastify.addContentTypeParser(['application/octet-stream', 'application/xml', 'text/xml', 'text/csv'], { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  fastify.addHook('preValidation', async (request) => {
    if (request.url === '/admin' || request.url.startsWith('/admin/')) return;
    const authorization = request.headers.authorization;
    const hasPresign = new URL(request.raw.url || '/', 'http://localhost').searchParams.has('X-Amz-Algorithm');
    const credentials = await resolveCredentials(s3, request, hasPresign);
    const accessKeyId = credentials?.accessKeyId;
    const secretAccessKey = credentials?.secretAccessKey;
    const signingCredentials = credentials ? { ...credentials, region: process.env.S3MINI_REGION || 'us-east-1' } : undefined;
    if (hasPresign && (!signingCredentials || !verifyPresignedSigV4({ method: request.method, url: request.raw.url || '/', headers: request.headers, body: Buffer.isBuffer(request.body) ? request.body : undefined }, signingCredentials))) {
      throw new S3Error('SignatureDoesNotMatch', 'The presigned URL signature does not match.', 403);
    }
    if (authorization && (!signingCredentials || !verifySigV4({ method: request.method, url: request.raw.url || '/', headers: request.headers, body: Buffer.isBuffer(request.body) ? request.body : undefined }, signingCredentials))) {
      throw new S3Error('SignatureDoesNotMatch', 'The request signature does not match.', 403);
    }
    if (credentials && (authorization || hasPresign)) await s3.markAccessKeyUsed(credentials.accessKeyId);
    const params = request.params as { bucket?: string; '*': string };
    const query = request.query as Record<string, string | undefined>;
    const key = params['*'] ? normalizeObjectKey(params['*']) : undefined;
    if (params.bucket && query.policy === undefined && query.acl === undefined && (key || request.method !== 'PUT')) {
      const action = key
        ? `${request.method === 'GET' || request.method === 'HEAD' ? 'Get' : request.method === 'PUT' ? 'Put' : request.method === 'DELETE' ? 'Delete' : request.method}Object`
        : request.method === 'GET' ? 'ListBucket' : `${request.method}Bucket`;
      const credentialsConfigured = Boolean(process.env.S3MINI_ACCESS_KEY && process.env.S3MINI_SECRET_KEY);
      const authenticatedPrincipal = authorization || hasPresign ? accessKeyId || '' : 'anonymous';
      const context = {
        's3:x-amz-acl': String(request.headers['x-amz-acl'] || ''),
        's3:prefix': query.prefix,
        'aws:PrincipalArn': authenticatedPrincipal,
      };
      if (await s3.isRequestDenied(params.bucket, key, `s3:${action}`, authenticatedPrincipal, context)) {
        throw new S3Error('AccessDenied', 'Access denied by bucket policy.', 403, params.bucket, key);
      }
      if (credentialsConfigured && key && authenticatedPrincipal === 'anonymous' && ['GetObject', 'PutObject', 'DeleteObject'].includes(action) && await s3.isObjectRequestDenied(params.bucket, key, action, authenticatedPrincipal)) {
        throw new S3Error('AccessDenied', 'Access denied by object ACL.', 403, params.bucket, key);
      }
    }
  });

  fastify.put('/internal/replication', async (request, reply) => {
    const expectedToken = process.env.S3MINI_REPLICATION_TOKEN;
    const suppliedToken = request.headers['x-s3mini-replication-token'];
    if (!expectedToken || !suppliedToken || !timingSafeTokenEqual(String(suppliedToken), expectedToken)) throw new S3Error('AccessDenied', 'The replication token is invalid.', 403);
    const bucket = String(request.headers['x-s3mini-bucket'] || '');
    const key = String(request.headers['x-s3mini-key'] || '');
    const versionId = String(request.headers['x-s3mini-version-id'] || '');
    const operation = String(request.headers['x-s3mini-operation'] || '');
    const deleteMarker = request.headers['x-s3mini-delete-marker'] === 'true';
    const etag = String(request.headers['x-s3mini-etag'] || '');
    const sha256 = request.headers['x-s3mini-sha256'] ? String(request.headers['x-s3mini-sha256']) : undefined;
    const lastModified = Number(request.headers['x-s3mini-last-modified']);
    if (!bucket || !key || !operation || (operation === 'PutObject' && !versionId) || !Number.isFinite(lastModified)) throw new S3Error('InvalidRequest', 'Replication metadata is incomplete.', 400);
    if (operation === 'PutObject') {
      if (!etag || !Buffer.isBuffer(request.body)) throw new S3Error('InvalidRequest', 'Replicated object data is missing.', 400);
      await s3.acceptReplicatedObject({ bucket, key, versionId, etag, sha256, lastModified, body: request.body });
    } else if (operation === 'DeleteObject') {
      await s3.acceptReplicatedDelete({ bucket, key, versionId, lastModified, deleteMarker });
    } else {
      throw new S3Error('InvalidRequest', 'The replication operation is unsupported.', 400);
    }
    return reply.code(204).send();
  });
  fastify.get('/internal/replication/inventory', async (request, reply) => {
    const expectedToken = process.env.S3MINI_REPLICATION_TOKEN;
    const suppliedToken = request.headers['x-s3mini-replication-token'];
    if (!expectedToken || !suppliedToken || !timingSafeTokenEqual(String(suppliedToken), expectedToken)) throw new S3Error('AccessDenied', 'The replication token is invalid.', 403);
    return reply.send(await s3.listReplicationInventory());
  });
  fastify.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof S3Error) {
      reply.type('application/xml').code(error.httpCode).send(error.toResponseXml(request.id));
    } else {
      fastify.log.error(error);
      reply.type('application/xml').code(500).send(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>${error.message}</Message><RequestId>${request.id}</RequestId></Error>`);
    }
  });

  async function requireAdmin(request: FastifyRequest): Promise<void> {
    const configuredToken = process.env.S3MINI_ADMIN_TOKEN;
    const suppliedToken = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined;
    if (configuredToken && suppliedToken && timingSafeTokenEqual(suppliedToken, configuredToken)) return;
    const oidcToken = getCookie(request, 's3mini_oidc_token');
    if (oidcToken && await isOidcAdmin(oidcToken)) return;
    throw new S3Error('AccessDenied', 'The admin token is invalid.', 403);
  }

  function oidcConfigured(): boolean {
    return Boolean(process.env.S3MINI_OIDC_CLIENT_ID && process.env.S3MINI_OIDC_CLIENT_SECRET);
  }

  function oidcBaseUrl(): string {
    return (process.env.S3MINI_OIDC_AUTH_URL || 'https://auth.api.apphor.de').replace(/\/$/, '');
  }

  function requestBaseUrl(request: FastifyRequest): string {
    const protocol = String(request.headers['x-forwarded-proto'] || 'http').split(',')[0];
    return `${protocol}://${request.headers.host || 'localhost'}`;
  }

  function getCookie(request: FastifyRequest, name: string): string | undefined {
    const value = String(request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
    return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
  }

  async function isOidcAdmin(token: string): Promise<boolean> {
    try {
      const response = await fetch(`${oidcBaseUrl()}/userinfo`, { headers: { authorization: `Bearer ${token}`, 'x-auth-audience': process.env.S3MINI_OIDC_AUDIENCE || process.env.S3MINI_OIDC_CLIENT_ID! } });
      if (!response.ok) return false;
      const user = await response.json() as { email?: string };
      const allowed = (process.env.S3MINI_OIDC_ADMIN_EMAILS || '').split(',').map(email => email.trim()).filter(Boolean);
      return !allowed.length || (!!user.email && allowed.includes(user.email));
    } catch {
      return false;
    }
  }

  fastify.get('/admin', async (request, reply) => {
    if (oidcConfigured() && !getCookie(request, 's3mini_oidc_token')) return reply.redirect('/admin/login');
    return reply.type('text/html').send(ADMIN_HTML);
  });
  fastify.get('/admin/login', async (request, reply) => {
    if (!oidcConfigured()) throw new S3Error('AccessDenied', 'OIDC is not configured.', 403);
    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(24).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = process.env.S3MINI_OIDC_REDIRECT_URI || `${requestBaseUrl(request)}/admin/callback`;
    const stateCookie = Buffer.from(JSON.stringify({ state, verifier }), 'utf8').toString('base64url');
    reply.header('Set-Cookie', `s3mini_oidc_state=${stateCookie}; HttpOnly; Path=/admin; SameSite=Lax; Max-Age=600`);
    const url = new URL(`${oidcBaseUrl()}/authorize`);
    url.search = new URLSearchParams({ response_type: 'code', client_id: process.env.S3MINI_OIDC_CLIENT_ID!, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return reply.redirect(url.toString());
  });
  fastify.get('/admin/callback', async (request, reply) => {
    if (!oidcConfigured()) throw new S3Error('AccessDenied', 'OIDC is not configured.', 403);
    const query = request.query as { code?: string; state?: string; error?: string };
    const saved = getCookie(request, 's3mini_oidc_state');
    if (!saved || !query.code || !query.state) throw new S3Error('AccessDenied', query.error || 'The OIDC callback is invalid.', 403);
    let state: { state: string; verifier: string };
    try { state = JSON.parse(Buffer.from(saved, 'base64url').toString('utf8')); } catch { throw new S3Error('AccessDenied', 'The OIDC state is invalid.', 403); }
    if (state.state !== query.state) throw new S3Error('AccessDenied', 'The OIDC state does not match.', 403);
    const redirectUri = process.env.S3MINI_OIDC_REDIRECT_URI || `${requestBaseUrl(request)}/admin/callback`;
    const tokenResponse = await fetch(`${oidcBaseUrl()}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: query.code, client_id: process.env.S3MINI_OIDC_CLIENT_ID!, client_secret: process.env.S3MINI_OIDC_CLIENT_SECRET!, redirect_uri: redirectUri, code_verifier: state.verifier }) });
    if (!tokenResponse.ok) throw new S3Error('AccessDenied', 'The OIDC token exchange failed.', 403);
    const token = (await tokenResponse.json() as { access_token?: string }).access_token;
    if (!token) throw new S3Error('AccessDenied', 'The OIDC token response was incomplete.', 403);
    reply.header('Set-Cookie', `s3mini_oidc_token=${encodeURIComponent(token)}; HttpOnly; Path=/admin; SameSite=Lax; Max-Age=3600`);
    return reply.redirect('/admin');
  });
  fastify.get('/admin/replication/health', { preHandler: requireAdmin }, async (_request, reply) => reply.send(replication?.getPeerHealth() || []));
  fastify.get('/admin/replication/events', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as { status?: string; limit?: string };
    const statuses = ['Pending', 'Delivered', 'Failed', 'DeadLetter'] as const;
    const status = statuses.includes(query.status as typeof statuses[number]) ? query.status as typeof statuses[number] : undefined;
    return reply.send(await s3.listReplicationEvents(Number(query.limit) || 100, status));
  });
  fastify.post('/admin/replication/events/:id/retry', { preHandler: requireAdmin }, async (request, reply) => {
    await s3.retryReplicationEvent(Number((request.params as { id: string }).id));
    return reply.code(204).send();
  });
  fastify.get('/admin/access-keys', { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(await s3.listAccessKeys());
  });
  fastify.post('/admin/access-keys', { preHandler: requireAdmin }, async (request, reply) => {
    const body = (request.body && typeof request.body === 'object') ? request.body as { displayName?: string } : {};
    return reply.code(201).send(await s3.createAccessKey(body.displayName || ''));
  });
  fastify.delete('/admin/access-keys/:accessKeyId', { preHandler: requireAdmin }, async (request, reply) => {
    const { accessKeyId } = request.params as { accessKeyId: string };
    await s3.setAccessKeyStatus(accessKeyId, 'Disabled');
    return reply.code(204).send();
  });
  fastify.get('/admin/buckets', { preHandler: requireAdmin }, async (_request, reply) => reply.send(await s3.listBuckets()));
  fastify.post('/admin/buckets', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body as { name?: string; locationConstraint?: string } : {};
    if (!body.name) throw new S3Error('InvalidBucketName', 'A bucket name is required.', 400);
    await s3.createBucket(body.name, body.locationConstraint);
    return reply.code(201).send({ name: body.name });
  });
  fastify.delete('/admin/buckets/:bucket', { preHandler: requireAdmin }, async (request, reply) => {
    await s3.deleteBucket((request.params as { bucket: string }).bucket);
    return reply.code(204).send();
  });
  fastify.get('/admin/buckets/:bucket/policy', { preHandler: requireAdmin }, async (request, reply) => {
    const bucket = (request.params as { bucket: string }).bucket;
    return reply.send((await s3.getBucketConfiguration(bucket, 'policy')) || {});
  });
  fastify.put('/admin/buckets/:bucket/policy', { preHandler: requireAdmin }, async (request, reply) => {
    const bucket = (request.params as { bucket: string }).bucket;
    if (!request.body || typeof request.body !== 'object') throw new S3Error('MalformedPolicy', 'A JSON bucket policy is required.', 400, bucket);
    await s3.putBucketConfiguration(bucket, 'policy', request.body);
    return reply.code(204).send();
  });
  fastify.delete('/admin/buckets/:bucket/policy', { preHandler: requireAdmin }, async (request, reply) => {
    await s3.deleteBucketConfiguration((request.params as { bucket: string }).bucket, 'policy');
    return reply.code(204).send();
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
      const value = configuration === 'lifecycleConfiguration' ? parseLifecycleXml(request.body) : parseJsonOrXml(request.body);
      await s3.putBucketConfiguration(params.bucket, configuration, value);
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
  fastify.post('/:bucket', async (request, reply) => {
    const params = request.params as { bucket: string };
    const query = request.query as Record<string, string | undefined>;
    if (query.delete === undefined) throw new S3Error('InvalidRequest', 'The delete query parameter is required.', 400, params.bucket);
    const keys = [...String(request.body || '').matchAll(/<Object\b[^>]*>\s*<Key>([^<]*)<\/Key>/g)].map(match => unescapeXml(match[1]));
    if (!keys.length) throw new S3Error('MalformedXML', 'At least one object key is required.', 400, params.bucket);
    const result = await s3.deleteObjects(params.bucket, keys);
    return reply.type('application/xml').send(wrapXml('DeleteResult', {
      Deleted: result.deleted.map(Key => ({ Key })),
      Errors: result.errors.map(error => ({ Key: error.key, Code: error.code })),
    }));
  });

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
      const body = String(request.body || '');
      const acl = body.includes('<Grant>') ? parseAclXml(body) : { CannedACL: canned };
      await s3.putObjectAcl(params.bucket, key, acl, query.versionId);
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
    const contentSha256 = request.headers['x-amz-content-sha256'];
    const contentSha256Digest = crypto.createHash('sha256').update(body).digest('hex');
    if (contentSha256 && contentSha256 !== 'UNSIGNED-PAYLOAD' && String(contentSha256) !== contentSha256Digest) {
      throw new S3Error('BadDigest', 'The x-amz-content-sha256 checksum did not match the request body.', 400, params.bucket, key);
    }
    const b2Sha1 = request.headers['x-bz-content-sha1'];
    const b2Sha1Digest = crypto.createHash('sha1').update(body).digest('hex');
    if (b2Sha1 && b2Sha1 !== 'do_not_verify' && String(b2Sha1) !== b2Sha1Digest) {
      throw new S3Error('BadDigest', 'The x-bz-content-sha1 checksum did not match the request body.', 400, params.bucket, key);
    }
    const contentMd5 = request.headers['content-md5'];
    const contentMd5Digest = crypto.createHash('md5').update(body).digest('base64');
    if (contentMd5 && String(contentMd5) !== contentMd5Digest) {
      throw new S3Error('BadDigest', 'The Content-MD5 checksum did not match the request body.', 400, params.bucket, key);
    }
    const checksumSha256 = crypto.createHash('sha256').update(body).digest('base64');
    if (checksum && checksum !== checksumSha256) {
      throw new S3Error('BadDigest', 'The SHA-256 checksum did not match the request body.', 400, params.bucket, key);
    }

    const meta: any = {};
    const storageClass = request.headers['x-amz-storage-class'];
    if (storageClass && !VALID_STORAGE_CLASSES.includes(String(storageClass) as any)) {
      throw new S3Error('InvalidStorageClass', 'The storage class is not supported.', 400, params.bucket, key);
    }
    if (storageClass) meta.storageClass = storageClass;
    if (request.headers['content-type']) meta.contentType = request.headers['content-type'];
    if (request.headers['content-language']) meta.contentLanguage = request.headers['content-language'];
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
      .header('Content-Language', metadata.contentLanguage || '')
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
      .header('Content-Language', metadata.contentLanguage || '')
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
      encodingType: query['encoding-type'] === 'url' ? 'url' : undefined,
    });

    const encodeListValue = (value: string) => result.encodingType === 'url' ? encodeURIComponent(value) : value;
    const response = {
      Name: params.bucket,
      Prefix: result.prefix,
      Delimiter: result.delimiter,
      MaxKeys: result.maxKeys,
      KeyCount: result.keyCount,
      IsTruncated: result.isTruncated,
      NextContinuationToken: result.nextContinuationToken,
       Contents: result.contents.map(c => ({
        Key: encodeListValue(c.key), LastModified: c.lastModified.toISOString(), ETag: c.etag,
        Size: c.size, StorageClass: c.storageClass
      })),
       CommonPrefixes: result.commonPrefixes.map(Prefix => ({ Prefix: encodeListValue(Prefix) })),
       EncodingType: result.encodingType,
    };
    reply.type('application/xml').send(wrapXml('ListObjectsV2Result', response));
  }

  fastify.put('/:bucket/*', putObject);
  fastify.post('/:bucket/*', async (request, reply) => {
    const params = request.params as { bucket: string };
    const key = normalizeObjectKey((request.params as any)['*'] as string);
    const query = request.query as Record<string, string | undefined>;
    if (!key && query.delete !== undefined) {
      const keys = [...String(request.body || '').matchAll(/<Object\b[^>]*>\s*<Key>([^<]*)<\/Key>/g)].map(match => unescapeXml(match[1]));
      if (!keys.length) throw new S3Error('MalformedXML', 'At least one object key is required.', 400, params.bucket);
      const result = await s3.deleteObjects(params.bucket, keys);
      return reply.type('application/xml').send(wrapXml('DeleteResult', { Deleted: result.deleted.map(Key => ({ Key })), Errors: result.errors.map(error => ({ Key: error.key, Code: error.code })) }));
    }
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

function parseAclXml(body: string): Record<string, unknown> {
  const grants = [...body.matchAll(/<Grant>\s*<Grantee(?:\s+[^>]*)?>([\s\S]*?)<\/Grantee>\s*<Permission>([^<]+)<\/Permission>\s*<\/Grant>/g)]
    .map(match => {
      const granteeBody = match[1];
      const grantee: Record<string, string> = {};
      for (const name of ['Type', 'ID', 'URI', 'DisplayName']) {
        const value = readXmlTag(granteeBody, name);
        if (value) grantee[name] = unescapeXml(value);
      }
      return { Grantee: grantee, Permission: unescapeXml(match[2]) };
    });
  return { Owner: { ID: '000000000000000000000000', DisplayName: 's3mini' }, Grants: grants };
}

function parseJsonOrXml(body: unknown): unknown {
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) return body;
  const text = String(body || '');
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function parseLifecycleXml(body: unknown): Record<string, unknown> {
  const text = String(body || '');
  const rules = [...text.matchAll(/<Rule\b[^>]*>([\s\S]*?)<\/Rule>/g)].map(match => {
    const ruleBody = match[1];
    const rule: Record<string, unknown> = {
      id: readXmlTag(ruleBody, 'ID'),
      status: readXmlTag(ruleBody, 'Status'),
      filter: { prefix: readXmlTag(ruleBody, 'Prefix') || '' },
    };
    const expiration: Record<string, string> = {};
    const expirationBody = ruleBody.match(/<Expiration(?:Configuration)?\b[^>]*>([\s\S]*?)<\/(?:Expiration|ExpirationConfiguration)>/)?.[1] || ruleBody;
    const days = readXmlTag(expirationBody, 'Days');
    const date = readXmlTag(expirationBody, 'Date');
    if (days) expiration.days = days;
    if (date) expiration.date = date;
    if (Object.keys(expiration).length) rule.expiration = expiration;
    rule.transitions = [...ruleBody.matchAll(/<Transition\b[^>]*>([\s\S]*?)<\/Transition>/g)].map(item => ({
      days: readXmlTag(item[1], 'Days'),
      date: readXmlTag(item[1], 'Date'),
      storageClass: readXmlTag(item[1], 'StorageClass'),
    }));
    rule.noncurrentVersionTransitions = [...ruleBody.matchAll(/<NoncurrentVersionTransition\b[^>]*>([\s\S]*?)<\/NoncurrentVersionTransition>/g)].map(item => ({
      noncurrentDays: readXmlTag(item[1], 'NoncurrentDays'),
      storageClass: readXmlTag(item[1], 'StorageClass'),
    }));
    const noncurrentExpirationBody = ruleBody.match(/<NoncurrentVersionExpiration\b[^>]*>([\s\S]*?)<\/NoncurrentVersionExpiration>/)?.[1];
    const noncurrentDays = noncurrentExpirationBody ? readXmlTag(noncurrentExpirationBody, 'NoncurrentDays') : undefined;
    if (noncurrentDays) rule.noncurrentVersionExpiration = { noncurrentDays };
    return rule;
  });
  return { rules };
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

async function resolveCredentials(s3: S3Mini, request: FastifyRequest, hasPresign: boolean): Promise<{ accessKeyId: string; secretAccessKey: string } | undefined> {
  const authorization = request.headers.authorization;
  if (!authorization && !hasPresign) return undefined;
  const url = new URL(request.raw.url || '/', 'http://localhost');
  const credentialValue = hasPresign
    ? url.searchParams.get('X-Amz-Credential') || undefined
    : authorization?.match(/Credential=([^,\s]+)/)?.[1];
  const accessKeyId = credentialValue ? decodeURIComponent(credentialValue).split('/')[0] : process.env.S3MINI_ACCESS_KEY;
  if (!accessKeyId) return undefined;
  if (accessKeyId === process.env.S3MINI_ACCESS_KEY && process.env.S3MINI_SECRET_KEY) {
    return { accessKeyId, secretAccessKey: process.env.S3MINI_SECRET_KEY };
  }
  const stored = await s3.getAccessKey(accessKeyId);
  return stored?.status === 'Active' ? stored : undefined;
}

function timingSafeTokenEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>S3MINI Control Plane</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #101418; color: #e6edf3; }
    body { max-width: 900px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 8px; letter-spacing: -0.03em; }
    p { color: #9daab8; }
    section { border: 1px solid #2b3540; border-radius: 10px; padding: 18px; margin-top: 18px; background: #171d23; }
    input, button { border: 1px solid #3b4855; border-radius: 6px; padding: 9px 11px; background: #0e1318; color: inherit; }
    input { min-width: 260px; }
    button { cursor: pointer; background: #245b82; border-color: #347cac; }
    button.danger { background: #743b42; border-color: #a95760; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 10px 6px; border-bottom: 1px solid #2b3540; }
    code { overflow-wrap: anywhere; }
    .healthy { color: #8bd49c; }
    .unhealthy, .dead { color: #f28b8b; }
    .unknown { color: #f0c674; }
    #message { min-height: 1.5em; color: #f0c674; }
  </style>
</head>
<body>
  <h1>S3MINI Control Plane</h1>
  <p>Manage access keys for this S3MINI instance. Secrets are shown only when a key is issued.</p>
  <section>
    <label>Admin token <input id="token" type="password" autocomplete="off"></label>
    <button id="load">Load keys</button>
    <p id="message"></p>
  </section>
  <section>
    <form id="create"><input id="name" placeholder="Display name" maxlength="120"><button>Issue access key</button></form>
    <pre id="issued"></pre>
    <table><thead><tr><th>Access key</th><th>Name</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody id="keys"></tbody></table>
  </section>
  <section>
    <h2>Replication</h2>
    <table><thead><tr><th>Peer</th><th>Status</th><th>Failures</th><th>Last activity</th></tr></thead><tbody id="peers"></tbody></table>
    <table><thead><tr><th>Object</th><th>Operation</th><th>Status</th><th>Attempts</th><th></th></tr></thead><tbody id="events"></tbody></table>
  </section>
  <section>
    <h2>Buckets</h2>
    <form id="bucket-create"><input id="bucket-name" placeholder="Bucket name" maxlength="63"><input id="bucket-region" placeholder="Location (optional)"><button>Create bucket</button></form>
    <table><thead><tr><th>Name</th><th>Created</th><th>Policy JSON</th><th></th></tr></thead><tbody id="buckets"></tbody></table>
  </section>
  <script>
    const token = () => document.querySelector('#token').value;
    const message = text => document.querySelector('#message').textContent = text || '';
    const html = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    const request = (url, options = {}) => fetch(url, { ...options, headers: { ...(options.body ? {'Content-Type': 'application/json'} : {}), Authorization: 'Bearer ' + token(), ...(options.headers || {}) } });
    async function load() {
      const response = await request('/admin/access-keys');
      if (!response.ok) return message('Unable to load keys (' + response.status + ').');
      const keys = await response.json();
      document.querySelector('#keys').innerHTML = keys.map(key => '<tr><td><code>' + html(key.accessKeyId) + '</code></td><td>' + html(key.displayName) + '</td><td>' + html(key.status) + '</td><td>' + html(new Date(key.createdAt).toLocaleString()) + '</td><td>' + (key.status === 'Active' ? '<button class="danger" data-id="' + html(key.accessKeyId) + '">Disable</button>' : '') + '</td></tr>').join('');
      document.querySelectorAll('[data-id]').forEach(button => button.onclick = async () => { await request('/admin/access-keys/' + encodeURIComponent(button.dataset.id), { method: 'DELETE' }); load(); });
      const healthResponse = await request('/admin/replication/health');
      if (healthResponse.ok) { const peers = await healthResponse.json(); document.querySelector('#peers').innerHTML = peers.map(peer => '<tr><td><code>' + html(peer.peer) + '</code></td><td class="' + html(peer.status.toLowerCase()) + '">' + html(peer.status) + '</td><td>' + html(peer.consecutiveFailures) + '</td><td>' + html(new Date(peer.lastSuccessAt || peer.lastFailureAt || 0).toLocaleString()) + '</td></tr>').join('') || '<tr><td colspan="4">No configured peers.</td></tr>'; }
      const eventsResponse = await request('/admin/replication/events?limit=100');
      if (eventsResponse.ok) { const events = await eventsResponse.json(); document.querySelector('#events').innerHTML = events.map(event => '<tr><td><code>' + html(event.bucket + '/' + event.key) + '</code></td><td>' + html(event.operation) + '</td><td class="' + (event.status === 'DeadLetter' ? 'dead' : '') + '">' + html(event.status) + '</td><td>' + html(event.attempts) + '</td><td>' + (event.status === 'DeadLetter' ? '<button data-retry="' + html(event.id) + '">Retry</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="5">No replication events.</td></tr>'; document.querySelectorAll('[data-retry]').forEach(button => button.onclick = async () => { await request('/admin/replication/events/' + button.dataset.retry + '/retry', { method: 'POST' }); load(); }); }
      const bucketsResponse = await request('/admin/buckets');
      if (bucketsResponse.ok) { const buckets = await bucketsResponse.json(); document.querySelector('#buckets').innerHTML = buckets.map(bucket => '<tr><td><code>' + html(bucket.name) + '</code></td><td>' + html(new Date(bucket.creationDate).toLocaleString()) + '</td><td><textarea data-policy="' + html(bucket.name) + '" rows="3" cols="34" placeholder="No policy"></textarea><br><button data-save-policy="' + html(bucket.name) + '">Save</button> <button class="danger" data-clear-policy="' + html(bucket.name) + '">Clear</button></td><td><button class="danger" data-delete-bucket="' + html(bucket.name) + '">Delete</button></td></tr>').join('') || '<tr><td colspan="4">No buckets.</td></tr>'; for (const bucket of buckets) { const response = await request('/admin/buckets/' + encodeURIComponent(bucket.name) + '/policy'); if (response.ok) document.querySelector('[data-policy="' + CSS.escape(bucket.name) + '"]').value = JSON.stringify(await response.json(), null, 2); } document.querySelectorAll('[data-save-policy]').forEach(button => button.onclick = async () => { const name = button.dataset.savePolicy; try { await request('/admin/buckets/' + encodeURIComponent(name) + '/policy', { method: 'PUT', body: document.querySelector('[data-policy="' + CSS.escape(name) + '"]').value }); load(); } catch { message('Unable to save policy.'); } }); document.querySelectorAll('[data-clear-policy]').forEach(button => button.onclick = async () => { await request('/admin/buckets/' + encodeURIComponent(button.dataset.clearPolicy) + '/policy', { method: 'DELETE' }); load(); }); document.querySelectorAll('[data-delete-bucket]').forEach(button => button.onclick = async () => { await request('/admin/buckets/' + encodeURIComponent(button.dataset.deleteBucket), { method: 'DELETE' }); load(); }); }
      message('');
    }
    document.querySelector('#load').onclick = load;
    document.querySelector('#bucket-create').onsubmit = async event => { event.preventDefault(); const name = document.querySelector('#bucket-name').value; const locationConstraint = document.querySelector('#bucket-region').value; const response = await request('/admin/buckets', { method: 'POST', body: JSON.stringify({ name, locationConstraint: locationConstraint || undefined }) }); if (!response.ok) return message('Unable to create bucket (' + response.status + ').'); document.querySelector('#bucket-name').value = ''; load(); };
    document.querySelector('#create').onsubmit = async event => { event.preventDefault(); const response = await request('/admin/access-keys', { method: 'POST', body: JSON.stringify({ displayName: document.querySelector('#name').value }) }); if (!response.ok) return message('Unable to issue key (' + response.status + ').'); const issued = await response.json(); document.querySelector('#issued').textContent = 'Access key: ' + issued.accessKeyId + '\\nSecret: ' + issued.secretAccessKey; document.querySelector('#name').value = ''; load(); };
  </script>
</body>
</html>`;
