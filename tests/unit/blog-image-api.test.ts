import { describe, expect, it, vi } from 'vitest';
import { parseBlogImagePath, serveBlogImage } from '../../api/blog-image.js';

function makeResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    body: undefined as Buffer | string | undefined,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(body?: Buffer | string) {
      this.body = body;
    },
    header(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
}

const GOOD_NAME = 'seoul-night-012345abcdef.webp';

describe('blog image path gate', () => {
  it('accepts only the managed immutable path format', () => {
    expect(parseBlogImagePath({ year: '2026', name: GOOD_NAME }))
      .toBe(`blog-images/2026/${GOOD_NAME}`);
    expect(parseBlogImagePath({ year: '2026', name: '../secret.webp' })).toBeNull();
    expect(parseBlogImagePath({ year: '26', name: GOOD_NAME })).toBeNull();
    expect(parseBlogImagePath({ year: '2026', name: 'legacy.webp' })).toBeNull();
  });
});

describe('blog image handler', () => {
  it('serves a validated WebP with immutable cache headers', async () => {
    const body = Buffer.from('RIFF-test-WEBP');
    const load = vi.fn(async () => ({
      contentType: 'image/webp',
      size: body.length,
      etag: '"v1"',
      bytes: async () => body,
    }));
    const res = makeResponse();

    await serveBlogImage(
      { method: 'GET', query: { year: '2026', name: GOOD_NAME }, headers: {} },
      res,
      load,
    );

    expect(load).toHaveBeenCalledWith(`blog-images/2026/${GOOD_NAME}`);
    expect(res.statusCode).toBe(200);
    expect(res.header('content-type')).toBe('image/webp');
    expect(res.header('x-content-type-options')).toBe('nosniff');
    expect(res.header('cache-control')).toContain('immutable');
    expect(res.body).toEqual(body);
  });

  it('supports HEAD without downloading the image bytes', async () => {
    const bytes = vi.fn(async () => Buffer.from('unused'));
    const res = makeResponse();
    await serveBlogImage(
      { method: 'HEAD', query: { year: '2026', name: GOOD_NAME }, headers: {} },
      res,
      async () => ({ contentType: 'image/webp', size: 12, etag: '', bytes }),
    );
    expect(res.statusCode).toBe(200);
    expect(bytes).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });

  it('returns 304 when the immutable ETag matches', async () => {
    const bytes = vi.fn();
    const res = makeResponse();
    await serveBlogImage(
      {
        method: 'GET',
        query: { year: '2026', name: GOOD_NAME },
        headers: { 'if-none-match': '"v1"' },
      },
      res,
      async () => ({ contentType: 'image/webp', size: 12, etag: '"v1"', bytes }),
    );
    expect(res.statusCode).toBe(304);
    expect(bytes).not.toHaveBeenCalled();
  });

  it('fails closed for invalid paths and storage misses', async () => {
    const invalidRes = makeResponse();
    const load = vi.fn();
    await serveBlogImage(
      { method: 'GET', query: { year: '2026', name: '../x.webp' }, headers: {} },
      invalidRes,
      load,
    );
    expect(invalidRes.statusCode).toBe(404);
    expect(load).not.toHaveBeenCalled();

    const missingRes = makeResponse();
    await serveBlogImage(
      { method: 'GET', query: { year: '2026', name: GOOD_NAME }, headers: {} },
      missingRes,
      async () => {
        throw Object.assign(new Error('missing'), { code: 404 });
      },
    );
    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.header('cache-control')).toBe('no-store');
  });

  it('rejects methods other than GET and HEAD', async () => {
    const res = makeResponse();
    await serveBlogImage(
      { method: 'POST', query: { year: '2026', name: GOOD_NAME }, headers: {} },
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(405);
    expect(res.header('allow')).toBe('GET, HEAD');
  });
});
