import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export interface SigV4Request {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body?: Buffer;
  now?: Date;
}

export function verifySigV4(request: SigV4Request, credentials: SigV4Credentials): boolean {
  const authorization = first(request.headers.authorization);
  if (!authorization?.startsWith('AWS4-HMAC-SHA256 ')) return false;
  const fields = parseFields(authorization.slice('AWS4-HMAC-SHA256 '.length));
  const credential = fields.Credential?.split('/');
  const signedHeaders = fields.SignedHeaders?.split(';').filter(Boolean);
  const signature = fields.Signature;
  if (!credential || credential.length !== 5 || !signedHeaders?.length || !signature) return false;
  const [accessKeyId, date, region, service, terminal] = credential;
  if (accessKeyId !== credentials.accessKeyId || region !== credentials.region || service !== (credentials.service || 's3') || terminal !== 'aws4_request') return false;

  const timestamp = first(request.headers['x-amz-date']);
  if (!timestamp || !/^\d{8}T\d{6}Z$/.test(timestamp) || timestamp.slice(0, 8) !== date) return false;
  const requestTime = Date.parse(`${timestamp.slice(0, 8)}T${timestamp.slice(9, 15)}Z`);
  const now = (request.now || new Date()).getTime();
  if (!Number.isFinite(requestTime) || Math.abs(now - requestTime) > 900_000) return false;

  const payloadHash = first(request.headers['x-amz-content-sha256']) || sha256(request.body || Buffer.alloc(0));
  const canonicalHeaders = signedHeaders.map(name => `${name}:${normalizeHeader(request.headers[name])}\n`).join('');
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(request.url),
    canonicalQuery(request.url),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), region), service), 'aws4_request');
  const expected = hmac(signingKey, stringToSign).toString('hex');
  return timingSafeEqual(expected, signature);
}

function parseFields(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/,\s*/).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function canonicalPath(url: string): string {
  return (url.split('?')[0] || '/').split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
}

function canonicalQuery(url: string): string {
  const query = new URL(url, 'http://localhost').searchParams;
  return [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

function normalizeHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',') .trim().replace(/\s+/g, ' ') : String(value || '').trim().replace(/\s+/g, ' ');
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
