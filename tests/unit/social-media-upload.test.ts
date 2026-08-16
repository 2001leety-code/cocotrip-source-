import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  SOCIAL_MEDIA_LIMITS,
  createSocialMediaUploadSession,
  createUploadId,
  finalizeSocialMediaUpload,
  handleSocialMediaUpload,
  inspectSocialMediaStream,
  parseUploadId,
  validateSocialMediaInit,
  verifySocialMediaUploadRequest,
} from '../../api/_shared/social-media-upload.js';

const SECRET = 'social-upload-test-token-that-is-longer-than-32-characters';
const NOW = Date.UTC(2026, 7, 16, 0, 0, 0);

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0,
    0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x02, 0x03,
    0xff, 0xd9,
  ]);
}

function mp4Bytes(brand = 'isom') {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write(brand, 8, 'ascii');
  bytes.write('iso2mp41', 12, 'ascii');
  bytes.writeUInt32BE(8, 24);
  bytes.write('free', 28, 'ascii');
  return bytes;
}

function makeResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    body: '',
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(body = '') {
      this.body = String(body);
    },
    json() {
      return JSON.parse(this.body);
    },
    header(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
}

function payloadFor(bytes: Buffer, contentType: 'image/jpeg' | 'video/mp4' = 'image/jpeg') {
  const extension = contentType === 'image/jpeg' ? 'jpg' : 'mp4';
  return {
    v: 1,
    s: `social-media-staging/${'a'.repeat(48)}.upload`,
    f: `social-media-${'b'.repeat(48)}.${extension}`,
    c: contentType,
    z: bytes.length,
    h: sha256(bytes),
    x: NOW + 10 * 60 * 1000,
  };
}

describe('Brain upload authentication', () => {
  it('fails closed when the server token is missing or too short', () => {
    const req = { headers: { authorization: `Bearer ${SECRET}` } };
    expect(verifySocialMediaUploadRequest(req, '')).toEqual({
      ok: false,
      status: 503,
      code: 'UPLOAD_DISABLED',
    });
    expect(verifySocialMediaUploadRequest(req, 'short')).toEqual({
      ok: false,
      status: 503,
      code: 'UPLOAD_DISABLED',
    });
  });

  it('accepts only the exact Bearer token', () => {
    expect(verifySocialMediaUploadRequest({ headers: {} }, SECRET)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifySocialMediaUploadRequest({
      headers: { authorization: 'Bearer wrong-token-that-is-longer-than-thirty-two' },
    }, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(verifySocialMediaUploadRequest({
      headers: { authorization: `Bearer ${SECRET}` },
    }, SECRET)).toEqual({ ok: true, token: SECRET });
  });
});

describe('media metadata gate', () => {
  const hash = 'ab'.repeat(32);

  it('allows only the narrow JPEG and MP4 contract', () => {
    expect(validateSocialMediaInit({
      filename: 'daily-photo.JPEG',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      sha256: hash.toUpperCase(),
    })).toMatchObject({ publicExtension: 'jpg', sha256: hash });
    expect(validateSocialMediaInit({
      filename: 'daily-video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 2048,
      sha256: hash,
    })).toMatchObject({ publicExtension: 'mp4' });
  });

  it.each([
    { filename: '../escape.jpg', contentType: 'image/jpeg', sizeBytes: 10, sha256: hash },
    { filename: 'renamed.png', contentType: 'image/jpeg', sizeBytes: 10, sha256: hash },
    { filename: 'photo.jpg', contentType: 'image/png', sizeBytes: 10, sha256: hash },
    { filename: 'video.mov', contentType: 'video/mp4', sizeBytes: 10, sha256: hash },
    { filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 0, sha256: hash },
    {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: SOCIAL_MEDIA_LIMITS['image/jpeg'].maxBytes + 1,
      sha256: hash,
    },
    { filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 10, sha256: 'not-a-hash' },
  ])('rejects unsafe metadata %#', (input) => {
    expect(() => validateSocialMediaInit(input)).toThrow();
  });

  it('normalizes a mixed-case contentType before the policy lookup', () => {
    expect(validateSocialMediaInit({
      filename: 'daily-photo.jpg',
      contentType: 'Image/JPEG',
      sizeBytes: 1024,
      sha256: hash,
    })).toMatchObject({ contentType: 'image/jpeg', publicExtension: 'jpg' });
    expect(validateSocialMediaInit({
      filename: 'daily-video.mp4',
      contentType: ' VIDEO/MP4 ',
      sizeBytes: 2048,
      sha256: hash,
    })).toMatchObject({ contentType: 'video/mp4', publicExtension: 'mp4' });
  });
});

describe('signed immutable upload session', () => {
  it('binds type, size, hash, staging path and final path to the uploadId', async () => {
    const getSignedUrl = vi.fn(async () => [
      'https://storage.googleapis.com/planning-with-ai-a0801.firebasestorage.app/staging?signature=hidden',
    ]);
    const file = vi.fn(() => ({ getSignedUrl }));
    let fill = 1;

    const result = await createSocialMediaUploadSession({
      filename: 'seoul.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 321,
      sha256: '12'.repeat(32),
    }, {
      bucket: { file },
      secret: SECRET,
      now: NOW,
      randomBytesFn: (size: number) => Buffer.alloc(size, fill++),
    });

    const signed = getSignedUrl.mock.calls[0][0];
    expect(signed).toMatchObject({
      version: 'v4',
      action: 'write',
      contentType: 'image/jpeg',
      extensionHeaders: {
        'x-goog-content-length-range': '321,321',
        'x-goog-if-generation-match': '0',
      },
    });
    expect(result.uploadHeaders).toEqual({
      'Content-Type': 'image/jpeg',
      'x-goog-content-length-range': '321,321',
      'x-goog-if-generation-match': '0',
    });

    const session = parseUploadId(result.uploadId, SECRET, NOW);
    expect(session).toMatchObject({
      c: 'image/jpeg',
      z: 321,
      h: '12'.repeat(32),
    });
    expect(session.s).toMatch(/^social-media-staging\/[a-f0-9]{48}\.upload$/);
    expect(session.f).toMatch(/^social-media-[a-f0-9]{48}\.jpg$/);
  });

  it('rejects a signed URL returned for an unexpected host', async () => {
    await expect(createSocialMediaUploadSession({
      filename: 'seoul.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 321,
      sha256: '12'.repeat(32),
    }, {
      bucket: {
        file: () => ({ getSignedUrl: async () => ['https://evil.example/upload'] }),
      },
      secret: SECRET,
      now: NOW,
    })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('rejects a tampered or expired uploadId', () => {
    const bytes = jpegBytes();
    const payload = payloadFor(bytes);
    const uploadId = createUploadId(payload, SECRET);
    expect(parseUploadId(uploadId, SECRET, NOW)).toEqual(payload);

    const tampered = `${uploadId.slice(0, -1)}${uploadId.endsWith('a') ? 'b' : 'a'}`;
    expect(() => parseUploadId(tampered, SECRET, NOW)).toThrowError(/INVALID_UPLOAD_ID/);
    expect(() => parseUploadId(uploadId, SECRET, payload.x)).toThrowError(/INVALID_UPLOAD_ID/);
  });
});

describe('full-file content inspection', () => {
  it('accepts a real JPEG signature split across stream chunks', async () => {
    const bytes = jpegBytes();
    await expect(inspectSocialMediaStream(
      Readable.from([bytes.subarray(0, 2), bytes.subarray(2, 11), bytes.subarray(11)]),
      { contentType: 'image/jpeg', sizeBytes: bytes.length, sha256: sha256(bytes) },
    )).resolves.toEqual({ sizeBytes: bytes.length, sha256: sha256(bytes) });
  });

  it('accepts a standard MP4 ftyp brand', async () => {
    const bytes = mp4Bytes('isom');
    await expect(inspectSocialMediaStream(Readable.from([bytes]), {
      contentType: 'video/mp4',
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    })).resolves.toMatchObject({ sizeBytes: bytes.length });
  });

  it.each([
    Buffer.from('not-a-jpeg'),
    Buffer.concat([jpegBytes(), Buffer.from('extra-after-eoi')]),
    mp4Bytes('qt  '),
  ])('rejects spoofed bytes %#', async (bytes) => {
    const contentType = bytes.length === 32 ? 'video/mp4' : 'image/jpeg';
    await expect(inspectSocialMediaStream(Readable.from([bytes]), {
      contentType,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    })).rejects.toMatchObject({ status: 422, code: 'INVALID_MEDIA' });
  });

  it('rejects a full-file SHA-256 mismatch', async () => {
    const bytes = jpegBytes();
    await expect(inspectSocialMediaStream(Readable.from([bytes]), {
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
      sha256: '00'.repeat(32),
    })).rejects.toMatchObject({ status: 422, code: 'INVALID_MEDIA' });
  });
});

describe('finalize and publish', () => {
  it('passes custom metadata in the real Cloud Storage File.copy request body', async () => {
    const app = initializeApp({ projectId: 'social-copy-contract-test' }, `social-copy-${Date.now()}`);
    try {
      const bucket = getStorage(app).bucket('social-copy-contract-test.appspot.com');
      const source = bucket.file('staging/source.upload');
      const destination = bucket.file(`social-media-${'c'.repeat(48)}.jpg`);
      let outgoing: Record<string, unknown> | undefined;
      Object.assign(source, {
        request(options: Record<string, unknown>, callback: (error: Error | null, body?: unknown) => void) {
          outgoing = options;
          callback(null, { done: true });
        },
      });

      await source.copy(destination, {
        preconditionOpts: { ifGenerationMatch: 0 },
        cacheControl: 'public, max-age=31536000, immutable',
        contentDisposition: 'inline',
        contentType: 'image/jpeg',
        metadata: {
          cocotripSocialValidated: '1',
          sha256: '12'.repeat(32),
        },
      });

      expect(outgoing).toMatchObject({
        qs: { ifGenerationMatch: 0 },
        json: {
          cacheControl: 'public, max-age=31536000, immutable',
          contentDisposition: 'inline',
          contentType: 'image/jpeg',
          metadata: {
            cocotripSocialValidated: '1',
            sha256: '12'.repeat(32),
          },
        },
      });
    } finally {
      await deleteApp(app);
    }
  });

  it('copies only a validated object to the immutable public path', async () => {
    const bytes = jpegBytes();
    const payload = payloadFor(bytes);
    const uploadId = createUploadId(payload, SECRET);
    const copy = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const staging = {
      getMetadata: vi.fn(async () => [{ contentType: 'image/jpeg', size: String(bytes.length) }]),
      createReadStream: () => Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]),
      copy,
      delete: remove,
    };
    const final = {
      exists: vi.fn(async () => [false]),
      getMetadata: vi.fn(),
    };
    const bucket = {
      file: vi.fn((path: string) => path === payload.s ? staging : final),
    };

    const result = await finalizeSocialMediaUpload(uploadId, { bucket, secret: SECRET, now: NOW });

    expect(result).toEqual({
      publicUrl: `https://cocotripkr.com/social-media/${'b'.repeat(48)}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    });
    expect(copy).toHaveBeenCalledWith(final, {
      preconditionOpts: { ifGenerationMatch: 0 },
      cacheControl: 'public, max-age=31536000, immutable',
      contentDisposition: 'inline',
      contentType: 'image/jpeg',
      metadata: {
        cocotripSocialValidated: '1',
        sha256: sha256(bytes),
      },
    });
    expect(remove).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('deletes invalid staging bytes without publishing them', async () => {
    const declared = jpegBytes();
    const spoofed = Buffer.alloc(declared.length, 0x41);
    const payload = payloadFor(declared);
    const copy = vi.fn();
    const remove = vi.fn(async () => undefined);
    const staging = {
      getMetadata: async () => [{ contentType: 'image/jpeg', size: String(spoofed.length) }],
      createReadStream: () => Readable.from([spoofed]),
      copy,
      delete: remove,
    };
    const final = { exists: async () => [false] };
    const bucket = { file: (path: string) => path === payload.s ? staging : final };

    await expect(finalizeSocialMediaUpload(createUploadId(payload, SECRET), {
      bucket,
      secret: SECRET,
      now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_MEDIA' });
    expect(copy).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it('returns the same URL when finalize is safely retried', async () => {
    const bytes = mp4Bytes();
    const payload = payloadFor(bytes, 'video/mp4');
    const final = {
      exists: async () => [true],
      getMetadata: async () => [{
        contentType: 'video/mp4',
        size: String(bytes.length),
        metadata: { cocotripSocialValidated: '1', sha256: sha256(bytes) },
      }],
    };
    const staging = {
      delete: vi.fn(async () => undefined),
      getMetadata: vi.fn(),
      copy: vi.fn(),
    };
    const bucket = { file: (path: string) => path === payload.f ? final : staging };

    const result = await finalizeSocialMediaUpload(createUploadId(payload, SECRET), {
      bucket,
      secret: SECRET,
      now: NOW,
    });
    expect(result.publicUrl).toBe(`https://cocotripkr.com/social-media/${'b'.repeat(48)}.mp4`);
    expect(staging.getMetadata).not.toHaveBeenCalled();
    expect(staging.copy).not.toHaveBeenCalled();
  });

  it('resolves a concurrent finalize race via the generation-match precondition, not a second write', async () => {
    const bytes = jpegBytes();
    const payload = payloadFor(bytes);
    let finalExists = false;
    const copy = vi.fn(async () => {
      // Simulates another request's finalize winning the ifGenerationMatch:0 race
      // between our existence check and our own copy attempt.
      finalExists = true;
      throw new Error('412 Precondition Failed');
    });
    const remove = vi.fn(async () => undefined);
    const staging = {
      getMetadata: vi.fn(async () => [{ contentType: 'image/jpeg', size: String(bytes.length) }]),
      createReadStream: () => Readable.from([bytes]),
      copy,
      delete: remove,
    };
    const final = {
      exists: vi.fn(async () => [finalExists]),
      getMetadata: vi.fn(async () => [{
        contentType: 'image/jpeg',
        size: String(bytes.length),
        metadata: { cocotripSocialValidated: '1', sha256: sha256(bytes) },
      }]),
    };
    const bucket = { file: (path: string) => path === payload.s ? staging : final };

    const result = await finalizeSocialMediaUpload(createUploadId(payload, SECRET), {
      bucket,
      secret: SECRET,
      now: NOW,
    });

    expect(copy).toHaveBeenCalledTimes(1);
    expect(result.publicUrl).toBe(`https://cocotripkr.com/social-media/${'b'.repeat(48)}.jpg`);
    expect(remove).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('fails closed when copy fails and no valid final object exists (not a benign race)', async () => {
    const bytes = jpegBytes();
    const payload = payloadFor(bytes);
    const staging = {
      getMetadata: vi.fn(async () => [{ contentType: 'image/jpeg', size: String(bytes.length) }]),
      createReadStream: () => Readable.from([bytes]),
      copy: vi.fn(async () => { throw new Error('network error'); }),
      delete: vi.fn(async () => undefined),
    };
    const final = { exists: vi.fn(async () => [false]), getMetadata: vi.fn() };
    const bucket = { file: (path: string) => path === payload.s ? staging : final };

    await expect(finalizeSocialMediaUpload(createUploadId(payload, SECRET), {
      bucket,
      secret: SECRET,
      now: NOW,
    })).rejects.toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
  });

  it('refuses to serve a name collision whose existing object does not match this payload', async () => {
    const bytes = jpegBytes();
    const payload = payloadFor(bytes);
    const final = {
      exists: async () => [true],
      getMetadata: async () => [{
        contentType: 'image/jpeg',
        size: String(bytes.length),
        metadata: { cocotripSocialValidated: '1', sha256: '00'.repeat(32) },
      }],
    };
    const staging = { getMetadata: vi.fn(), createReadStream: vi.fn(), copy: vi.fn(), delete: vi.fn() };
    const bucket = { file: (path: string) => path === payload.f ? final : staging };

    await expect(finalizeSocialMediaUpload(createUploadId(payload, SECRET), {
      bucket,
      secret: SECRET,
      now: NOW,
    })).rejects.toMatchObject({ status: 409, code: 'FINAL_PATH_CONFLICT' });
  });

  it('deletes staging and refuses to finalize when the uploaded size disagrees with the signed session', async () => {
    const bytes = jpegBytes();
    const payload = payloadFor(bytes);
    const remove = vi.fn(async () => undefined);
    const staging = {
      getMetadata: vi.fn(async () => [{ contentType: 'image/jpeg', size: String(bytes.length + 1) }]),
      createReadStream: vi.fn(),
      copy: vi.fn(),
      delete: remove,
    };
    const final = { exists: async () => [false] };
    const bucket = { file: (path: string) => path === payload.s ? staging : final };

    await expect(finalizeSocialMediaUpload(createUploadId(payload, SECRET), {
      bucket,
      secret: SECRET,
      now: NOW,
    })).rejects.toMatchObject({ status: 422, code: 'INVALID_MEDIA' });
    expect(remove).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('reports an incomplete upload rather than crashing when staging never landed', async () => {
    const payload = payloadFor(jpegBytes());
    const staging = { getMetadata: vi.fn(async () => { throw new Error('404 Not Found'); }) };
    const final = { exists: async () => [false] };
    const bucket = { file: (path: string) => path === payload.s ? staging : final };

    await expect(finalizeSocialMediaUpload(createUploadId(payload, SECRET), {
      bucket,
      secret: SECRET,
      now: NOW,
    })).rejects.toMatchObject({ status: 409, code: 'UPLOAD_INCOMPLETE' });
  });
});

describe('HTTP API contract', () => {
  const request = (body: Record<string, unknown>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  it('does not touch storage for an unauthenticated request', async () => {
    const createSession = vi.fn();
    const res = makeResponse();
    await handleSocialMediaUpload(request({ action: 'init' }), res, {
      authenticate: () => ({ ok: false, status: 401, code: 'AUTH_REQUIRED' }),
      createSession,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
    expect(res.body).not.toContain(SECRET);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('returns the init and finalize contracts with no-store responses', async () => {
    const createSession = vi.fn(async () => ({
      uploadId: 'opaque-id',
      uploadUrl: 'https://storage.googleapis.com/signed',
      uploadHeaders: { 'Content-Type': 'image/jpeg' },
      expiresAt: '2026-08-16T00:15:00.000Z',
    }));
    const initRes = makeResponse();
    await handleSocialMediaUpload(request({ action: 'init', filename: 'x.jpg' }), initRes, {
      authenticate: () => ({ ok: true, token: SECRET }),
      createSession,
    });
    expect(initRes.statusCode).toBe(201);
    expect(initRes.json()).toMatchObject({ ok: true, uploadId: 'opaque-id' });
    expect(initRes.header('cache-control')).toBe('no-store');
    expect(initRes.header('x-content-type-options')).toBe('nosniff');

    const finalizeUpload = vi.fn(async () => ({
      publicUrl: 'https://cocotripkr.com/social-media/id.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 12,
      sha256: '12'.repeat(32),
    }));
    const finalizeRes = makeResponse();
    await handleSocialMediaUpload(request({ action: 'finalize', uploadId: 'opaque-id' }), finalizeRes, {
      authenticate: () => ({ ok: true, token: SECRET }),
      finalizeUpload,
    });
    expect(finalizeRes.statusCode).toBe(200);
    expect(finalizeRes.json()).toMatchObject({
      ok: true,
      publicUrl: 'https://cocotripkr.com/social-media/id.jpg',
    });
  });

  it('rejects non-JSON bodies and non-POST methods', async () => {
    const jsonRequired = makeResponse();
    await handleSocialMediaUpload({
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'bytes',
    }, jsonRequired, {
      authenticate: () => ({ ok: true, token: SECRET }),
    });
    expect(jsonRequired.statusCode).toBe(415);

    const method = makeResponse();
    await handleSocialMediaUpload({ method: 'GET', headers: {} }, method);
    expect(method.statusCode).toBe(405);
    expect(method.header('allow')).toBe('POST');
  });

  it('rejects an oversized JSON body before reading it', async () => {
    const res = makeResponse();
    const createSession = vi.fn();
    await handleSocialMediaUpload({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(17 * 1024) },
      body: undefined,
      [Symbol.asyncIterator]: async function* () {},
    }, res, {
      authenticate: () => ({ ok: true, token: SECRET }),
      createSession,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ ok: false, code: 'REQUEST_TOO_LARGE' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects an oversized pre-parsed object body even with no Content-Length header', async () => {
    const res = makeResponse();
    const createSession = vi.fn();
    const oversizedPayload = 'x'.repeat(17 * 1024);
    await handleSocialMediaUpload({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { action: 'init', filename: oversizedPayload },
    }, res, {
      authenticate: () => ({ ok: true, token: SECRET }),
      createSession,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ ok: false, code: 'REQUEST_TOO_LARGE' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects an oversized pre-parsed object body when Content-Length is reported as zero', async () => {
    const res = makeResponse();
    const createSession = vi.fn();
    const oversizedPayload = 'x'.repeat(17 * 1024);
    await handleSocialMediaUpload({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '0' },
      body: { action: 'init', filename: oversizedPayload },
    }, res, {
      authenticate: () => ({ ok: true, token: SECRET }),
      createSession,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ ok: false, code: 'REQUEST_TOO_LARGE' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects a JSON array body and an unrecognized action', async () => {
    const arrayRes = makeResponse();
    await handleSocialMediaUpload(request([1, 2, 3] as unknown as Record<string, unknown>), arrayRes, {
      authenticate: () => ({ ok: true, token: SECRET }),
    });
    expect(arrayRes.statusCode).toBe(400);
    expect(arrayRes.json()).toEqual({ ok: false, code: 'INVALID_JSON' });

    const unknownRes = makeResponse();
    await handleSocialMediaUpload(request({ action: 'delete' }), unknownRes, {
      authenticate: () => ({ ok: true, token: SECRET }),
    });
    expect(unknownRes.statusCode).toBe(400);
    expect(unknownRes.json()).toEqual({ ok: false, code: 'INVALID_ACTION' });
  });

  it('never echoes the bearer token back in a response body, even on failure', async () => {
    const res = makeResponse();
    await handleSocialMediaUpload(request({ action: 'init' }), res, {
      authenticate: () => ({ ok: false, status: 503, code: 'UPLOAD_DISABLED' }),
    });
    expect(res.body).not.toContain(SECRET);
    expect(res.header('cache-control')).toBe('no-store');
  });
});

describe('function deployment config', () => {
  it('gives the upload endpoint its own memory/duration budget for signed-URL + full-file streaming work', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(vercel.functions['api/social-media-upload.js']).toMatchObject({
      maxDuration: 60,
      memory: 512,
    });
  });
});

describe('public hosting configuration', () => {
  const root = process.cwd();
  const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  const rules = readFileSync(join(root, 'storage.rules'), 'utf8');

  it('uses a fixed Firebase origin rewrite, never a caller-controlled redirect', () => {
    const rewrites = vercel.rewrites.filter((item: { source: string }) => item.source.startsWith('/social-media/'));
    expect(rewrites).toEqual([
      {
        source: '/social-media/:id([a-f0-9]{48}).jpg',
        destination: 'https://firebasestorage.googleapis.com/v0/b/planning-with-ai-a0801.firebasestorage.app/o/social-media-:id.jpg?alt=media',
      },
      {
        source: '/social-media/:id([a-f0-9]{48}).mp4',
        destination: 'https://firebasestorage.googleapis.com/v0/b/planning-with-ai-a0801.firebasestorage.app/o/social-media-:id.mp4?alt=media',
      },
    ]);
    expect(rewrites.every((item: { destination: string }) => (
      item.destination.startsWith('https://firebasestorage.googleapis.com/v0/b/planning-with-ai-a0801.firebasestorage.app/o/')
      && !/:(url|host|origin)/.test(item.destination)
    ))).toBe(true);
    expect(vercel.redirects.some((item: { source: string }) => item.source.includes('social-media'))).toBe(false);
  });

  it('does not proxy arbitrary names, extra extensions, encoded paths, or hosts', () => {
    const allowedPath = /^\/social-media\/[a-f0-9]{48}\.(jpg|mp4)$/;
    expect(allowedPath.test(`/social-media/${'a'.repeat(48)}.jpg`)).toBe(true);
    expect(allowedPath.test(`/social-media/${'a'.repeat(48)}.mp4`)).toBe(true);
    expect(allowedPath.test('/social-media/short.jpg')).toBe(false);
    expect(allowedPath.test(`/social-media/${'a'.repeat(48)}.jpg.exe`)).toBe(false);
    expect(allowedPath.test(`/social-media/${'a'.repeat(47)}%2F.jpg`)).toBe(false);
    expect(allowedPath.test('/social-media/https:%2F%2Fevil.example%2Fx.jpg')).toBe(false);
  });

  it('opts the immutable social-media rewrite into Vercel CDN caching via the documented header', () => {
    const headerEntry = vercel.headers.find((item: { source: string }) => item.source === '/social-media/(.*)');
    expect(headerEntry.headers).toContainEqual({
      key: 'x-vercel-enable-rewrite-caching',
      value: '1',
    });
  });

  it('marks only server-validated random media public and denies client writes', () => {
    expect(rules).toContain("fileName.matches('social-media-[a-f0-9]{48}[.](jpg|mp4)')");
    expect(rules).toContain("resource.metadata.cocotripSocialValidated == '1'");
    expect(rules).toMatch(/match \/\{fileName\}[\s\S]*?allow write: if false;/);
  });
});
