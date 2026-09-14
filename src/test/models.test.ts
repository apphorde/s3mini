import { describe, expect, it } from 'vitest';
import { COPY_SOURCE_MAX, DEFAULT_OWNER_ID, S3Error, generateETag, generateVersionId } from '../types/models.js';

describe('S3 model helpers', () => {
  it('creates an S3 error with XML output', () => {
    const error = new S3Error('NoSuchKey', 'missing', 404, 'bucket', 'key');
    const xml = error.toResponseXml('request-id');
    expect(error.httpCode).toBe(404);
    expect(xml).toContain('<Code>NoSuchKey</Code>');
    expect(xml).toContain('<BucketName>bucket</BucketName>');
    expect(xml).toContain('<KeyName>key</KeyName>');
  });

  it('escapes XML error text', () => {
    expect(new S3Error('Invalid', '<bad>&').toResponseXml('id')).toContain('&lt;bad&gt;&amp;');
  });

  it('generates deterministic quoted MD5 ETags', () => {
    expect(generateETag(Buffer.from('hello'))).toBe('"5d41402abc4b2a76b9719d911017c592"');
  });

  it('generates 33-character version IDs', () => {
    const versionId = generateVersionId();
    expect(versionId).toMatch(/^[A-Za-z0-9]{32}\+$/);
  });

  it('defines storage constants', () => {
    expect(DEFAULT_OWNER_ID).toHaveLength(24);
    expect(COPY_SOURCE_MAX).toBe(5 * 1024 * 1024);
  });
});
