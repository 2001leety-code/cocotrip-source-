import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { initAdminDb } from './firebase-admin.js';

// The public Vercel rewrite points at this existing production Firebase bucket.
// Bucket names are public identifiers, not credentials. Keeping the destination
// fixed prevents this endpoint from becoming an arbitrary proxy/open redirect.
export const SOCIAL_MEDIA_BUCKET = 'planning-with-ai-a0801.firebasestorage.app';
export const SOCIAL_MEDIA_PUBLIC_ORIGIN = 'https://cocotripkr.com';

export const SOCIAL_MEDIA_LIMITS = Object.freeze({
  'image/jpeg': Object.freeze({
    extensions: Object.freeze(['jpg', 'jpeg']),
    publicExtension: 'jpg',
    maxBytes: 10 * 1024 * 1024,
  }),
  'video/mp4': Object.freeze({
    extensions: Object.freeze(['mp4']),
    publicExtension: 'mp4',
    maxBytes: 100 * 1024 * 1024,
  }),
});

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
const UPLOAD_SESSION_TTL_MS = 20 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const STAGING_RE = /^social-media-staging\/[a-f0-9]{48}\.upload$/;
const FINAL_RE = /^social-media-[a-f0-9]{48}\.(jpg|mp4)$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MP4_BRANDS = new Set([
  'avc1', 'dash', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'isom',
  'M4V ', 'mp41', 'mp42', 'MSNV',
]);

export class SocialMediaUploadError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'SocialMediaUploadError';
    this.status = status;
    this.code = code;
  }
}

function sha256Bytes(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function constantTimeStringEqual(left, right) {
  return timingSafeEqual(sha256Bytes(left), sha256Bytes(right));
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function requestHeader(req, name) {
  const lower = name.toLowerCase();
  return firstHeaderValue(req.headers?.[lower] || req.headers?.[name] || '');
}

export function verifySocialMediaUploadRequest(
  req,
  configuredToken = process.env.SOCIAL_MEDIA_UPLOAD_TOKEN || '',
) {
  const expected = String(configuredToken || '').trim();
  if (expected.length < 32) {
    return { ok: false, status: 503, code: 'UPLOAD_DISABLED' };
  }

  const authorization = String(requestHeader(req, 'authorization') || '');
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || !constantTimeStringEqual(match[1], expected)) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED' };
  }

  return { ok: true, token: expected };
}

function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function validateSocialMediaInit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SocialMediaUploadError(400, 'INVALID_REQUEST');
  }

  const filename = input.filename;
  const contentType = typeof input.contentType === 'string' ? input.contentType.trim().toLowerCase() : '';
  const sizeBytes = input.sizeBytes;
  const sha256 = typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : '';

  if (
    typeof filename !== 'string'
    || filename.length < 1
    || filename.length > 128
    || filename.startsWith('.')
    || !/^[^/\\\0]+$/.test(filename)
    || typeof input.contentType !== 'string'
  ) {
    throw new SocialMediaUploadError(400, 'INVALID_MEDIA_METADATA');
  }

  const policy = SOCIAL_MEDIA_LIMITS[contentType];
  const extension = extensionOf(filename);
  if (!policy || !policy.extensions.includes(extension)) {
    throw new SocialMediaUploadError(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > policy.maxBytes) {
    throw new SocialMediaUploadError(413, 'INVALID_MEDIA_SIZE');
  }
  if (!SHA256_RE.test(sha256)) {
    throw new SocialMediaUploadError(400, 'INVALID_SHA256');
  }

  return {
    filename,
    contentType,
    sizeBytes,
    sha256,
    publicExtension: policy.publicExtension,
  };
}

function signUploadPayload(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url');
}

export function createUploadId(payload, secret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${signUploadPayload(encodedPayload, secret)}`;
}

function uploadPayloadIsValid(payload, now) {
  if (!payload || typeof payload !== 'object' || payload.v !== 1) return false;
  if (!STAGING_RE.test(String(payload.s || ''))) return false;
  if (!FINAL_RE.test(String(payload.f || ''))) return false;
  if (!Object.hasOwn(SOCIAL_MEDIA_LIMITS, payload.c)) return false;
  if (!Number.isSafeInteger(payload.z) || payload.z < 1) return false;
  if (payload.z > SOCIAL_MEDIA_LIMITS[payload.c].maxBytes) return false;
  if (!SHA256_RE.test(String(payload.h || ''))) return false;
  if (!Number.isSafeInteger(payload.x) || payload.x <= now) return false;
  return payload.f.endsWith(`.${SOCIAL_MEDIA_LIMITS[payload.c].publicExtension}`);
}

export function parseUploadId(uploadId, secret, now = Date.now()) {
  if (typeof uploadId !== 'string' || uploadId.length > 2048) {
    throw new SocialMediaUploadError(400, 'INVALID_UPLOAD_ID');
  }

  const parts = uploadId.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new SocialMediaUploadError(400, 'INVALID_UPLOAD_ID');
  }
  const expectedSignature = signUploadPayload(parts[0], secret);
  if (!constantTimeStringEqual(parts[1], expectedSignature)) {
    throw new SocialMediaUploadError(400, 'INVALID_UPLOAD_ID');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw new SocialMediaUploadError(400, 'INVALID_UPLOAD_ID');
  }
  if (!uploadPayloadIsValid(payload, now)) {
    throw new SocialMediaUploadError(400, 'INVALID_UPLOAD_ID');
  }
  return payload;
}

function productionBucket() {
  // Reuse the established Firebase Admin bootstrap. Calling it also applies the
  // repository's preview/production Firebase environment guard.
  initAdminDb('social-media-upload');
  const app = getApps()[0];
  if (!app) throw new SocialMediaUploadError(503, 'STORAGE_UNAVAILABLE');
  return getStorage(app).bucket(SOCIAL_MEDIA_BUCKET);
}

function randomHex(bytes = 24, randomBytesFn = randomBytes) {
  return randomBytesFn(bytes).toString('hex');
}

export async function createSocialMediaUploadSession(input, options = {}) {
  const validated = validateSocialMediaInit(input);
  const secret = String(options.secret || process.env.SOCIAL_MEDIA_UPLOAD_TOKEN || '').trim();
  if (secret.length < 32) throw new SocialMediaUploadError(503, 'UPLOAD_DISABLED');

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const randomBytesFn = options.randomBytesFn || randomBytes;
  const stagingPath = `social-media-staging/${randomHex(24, randomBytesFn)}.upload`;
  const finalPath = `social-media-${randomHex(24, randomBytesFn)}.${validated.publicExtension}`;
  const expiresAt = now + UPLOAD_URL_TTL_MS;
  const sessionExpiresAt = now + UPLOAD_SESSION_TTL_MS;
  const payload = {
    v: 1,
    s: stagingPath,
    f: finalPath,
    c: validated.contentType,
    z: validated.sizeBytes,
    h: validated.sha256,
    x: sessionExpiresAt,
  };
  const uploadHeaders = {
    'Content-Type': validated.contentType,
    'x-goog-content-length-range': `${validated.sizeBytes},${validated.sizeBytes}`,
    'x-goog-if-generation-match': '0',
  };

  const bucket = options.bucket || productionBucket();
  let uploadUrl;
  try {
    [uploadUrl] = await bucket.file(stagingPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType: validated.contentType,
      extensionHeaders: {
        'x-goog-content-length-range': uploadHeaders['x-goog-content-length-range'],
        'x-goog-if-generation-match': uploadHeaders['x-goog-if-generation-match'],
      },
    });
  } catch {
    throw new SocialMediaUploadError(503, 'STORAGE_UNAVAILABLE');
  }

  let parsedUploadUrl;
  try {
    parsedUploadUrl = new URL(uploadUrl);
  } catch {
    throw new SocialMediaUploadError(503, 'STORAGE_UNAVAILABLE');
  }
  const allowedUploadHost = parsedUploadUrl.hostname === 'storage.googleapis.com'
    || parsedUploadUrl.hostname.endsWith('.storage.googleapis.com');
  if (parsedUploadUrl.protocol !== 'https:' || !allowedUploadHost) {
    throw new SocialMediaUploadError(503, 'STORAGE_UNAVAILABLE');
  }

  return {
    uploadId: createUploadId(payload, secret),
    uploadUrl,
    uploadHeaders,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function mediaMagicIsValid(contentType, prefix, suffix) {
  if (contentType === 'image/jpeg') {
    return prefix.length >= 3
      && prefix[0] === 0xff
      && prefix[1] === 0xd8
      && prefix[2] === 0xff
      && suffix.length === 2
      && suffix[0] === 0xff
      && suffix[1] === 0xd9;
  }
  if (contentType === 'video/mp4') {
    if (prefix.length < 12 || prefix.toString('ascii', 4, 8) !== 'ftyp') return false;
    const firstBoxSize = prefix.readUInt32BE(0);
    const brand = prefix.toString('ascii', 8, 12);
    return firstBoxSize >= 12 && MP4_BRANDS.has(brand);
  }
  return false;
}

export async function inspectSocialMediaStream(stream, expected) {
  const hash = createHash('sha256');
  let prefix = Buffer.alloc(0);
  let suffix = Buffer.alloc(0);
  let bytesRead = 0;

  try {
    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      bytesRead += chunk.length;
      if (bytesRead > expected.sizeBytes) {
        throw new SocialMediaUploadError(422, 'INVALID_MEDIA');
      }
      hash.update(chunk);
      if (prefix.length < 32) {
        prefix = Buffer.concat([prefix, chunk]).subarray(0, 32);
      }
      suffix = Buffer.concat([suffix, chunk]).subarray(-2);
    }
  } catch (error) {
    if (error instanceof SocialMediaUploadError) throw error;
    throw new SocialMediaUploadError(503, 'STORAGE_UNAVAILABLE');
  }

  const digest = hash.digest('hex');
  if (
    bytesRead !== expected.sizeBytes
    || !constantTimeStringEqual(digest, expected.sha256)
    || !mediaMagicIsValid(expected.contentType, prefix, suffix)
  ) {
    throw new SocialMediaUploadError(422, 'INVALID_MEDIA');
  }

  return { sizeBytes: bytesRead, sha256: digest };
}

function metadataMatchesFinal(metadata, payload) {
  const custom = metadata.metadata || {};
  return String(metadata.contentType || '').toLowerCase() === payload.c
    && Number(metadata.size || 0) === payload.z
    && custom.cocotripSocialValidated === '1'
    && constantTimeStringEqual(custom.sha256 || '', payload.h);
}

async function existingFinalResult(finalFile, payload) {
  try {
    const [exists] = await finalFile.exists();
    if (!exists) return null;
    const [metadata] = await finalFile.getMetadata();
    if (!metadataMatchesFinal(metadata, payload)) {
      throw new SocialMediaUploadError(409, 'FINAL_PATH_CONFLICT');
    }
    return metadata;
  } catch (error) {
    if (error instanceof SocialMediaUploadError) throw error;
    throw new SocialMediaUploadError(503, 'STORAGE_UNAVAILABLE');
  }
}

async function deleteStagingBestEffort(stagingFile) {
  try {
    await stagingFile.delete({ ignoreNotFound: true });
  } catch {
    // The finalized immutable object is authoritative. A failed staging cleanup
    // must not turn a successful publish into a retry that could duplicate work.
  }
}

function publicResult(payload) {
  const publicName = payload.f.slice('social-media-'.length);
  return {
    publicUrl: `${SOCIAL_MEDIA_PUBLIC_ORIGIN}/social-media/${publicName}`,
    contentType: payload.c,
    sizeBytes: payload.z,
    sha256: payload.h,
  };
}

export async function finalizeSocialMediaUpload(uploadId, options = {}) {
  const secret = String(options.secret || process.env.SOCIAL_MEDIA_UPLOAD_TOKEN || '').trim();
  if (secret.length < 32) throw new SocialMediaUploadError(503, 'UPLOAD_DISABLED');
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const payload = parseUploadId(uploadId, secret, now);
  const bucket = options.bucket || productionBucket();
  const stagingFile = bucket.file(payload.s);
  const finalFile = bucket.file(payload.f);

  const existing = await existingFinalResult(finalFile, payload);
  if (existing) {
    await deleteStagingBestEffort(stagingFile);
    return publicResult(payload);
  }

  let stagingMetadata;
  try {
    [stagingMetadata] = await stagingFile.getMetadata();
  } catch {
    throw new SocialMediaUploadError(409, 'UPLOAD_INCOMPLETE');
  }

  if (
    String(stagingMetadata.contentType || '').toLowerCase() !== payload.c
    || Number(stagingMetadata.size || 0) !== payload.z
  ) {
    await deleteStagingBestEffort(stagingFile);
    throw new SocialMediaUploadError(422, 'INVALID_MEDIA');
  }

  try {
    await inspectSocialMediaStream(stagingFile.createReadStream(), {
      contentType: payload.c,
      sizeBytes: payload.z,
      sha256: payload.h,
    });
  } catch (error) {
    if (error instanceof SocialMediaUploadError && error.status === 422) {
      await deleteStagingBestEffort(stagingFile);
    }
    throw error;
  }

  try {
    await stagingFile.copy(finalFile, {
      preconditionOpts: { ifGenerationMatch: 0 },
      cacheControl: 'public, max-age=31536000, immutable',
      contentDisposition: 'inline',
      contentType: payload.c,
      metadata: {
        cocotripSocialValidated: '1',
        sha256: payload.h,
      },
    });
  } catch {
    const racedFinal = await existingFinalResult(finalFile, payload);
    if (!racedFinal) throw new SocialMediaUploadError(503, 'STORAGE_UNAVAILABLE');
  }

  await deleteStagingBestEffort(stagingFile);
  return publicResult(payload);
}

async function readJsonBody(req) {
  const contentLength = Number(requestHeader(req, 'content-length') || 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_JSON_BODY_BYTES) {
    throw new SocialMediaUploadError(413, 'REQUEST_TOO_LARGE');
  }

  if (req.body !== undefined) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      if (Array.isArray(req.body)) throw new SocialMediaUploadError(400, 'INVALID_JSON');
      let serialized;
      try {
        serialized = JSON.stringify(req.body);
      } catch {
        throw new SocialMediaUploadError(400, 'INVALID_JSON');
      }
      if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BODY_BYTES) {
        throw new SocialMediaUploadError(413, 'REQUEST_TOO_LARGE');
      }
      return req.body;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BODY_BYTES) {
      throw new SocialMediaUploadError(413, 'REQUEST_TOO_LARGE');
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
      return parsed;
    } catch {
      throw new SocialMediaUploadError(400, 'INVALID_JSON');
    }
  }

  const chunks = [];
  let total = 0;
  try {
    for await (const rawChunk of req) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        throw new SocialMediaUploadError(413, 'REQUEST_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof SocialMediaUploadError) throw error;
    throw new SocialMediaUploadError(400, 'INVALID_JSON');
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed;
  } catch {
    throw new SocialMediaUploadError(400, 'INVALID_JSON');
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export async function handleSocialMediaUpload(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const authenticate = dependencies.authenticate || verifySocialMediaUploadRequest;
  const auth = authenticate(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, code: auth.code });
    return;
  }

  const contentType = String(requestHeader(req, 'content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    sendJson(res, 415, { ok: false, code: 'JSON_REQUIRED' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (body.action === 'init') {
      const createSession = dependencies.createSession || createSocialMediaUploadSession;
      const result = await createSession(body, { secret: auth.token });
      sendJson(res, 201, { ok: true, ...result });
      return;
    }
    if (body.action === 'finalize') {
      const finalizeUpload = dependencies.finalizeUpload || finalizeSocialMediaUpload;
      const result = await finalizeUpload(body.uploadId, { secret: auth.token });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    throw new SocialMediaUploadError(400, 'INVALID_ACTION');
  } catch (error) {
    if (error instanceof SocialMediaUploadError) {
      sendJson(res, error.status, { ok: false, code: error.code });
      return;
    }
    sendJson(res, 503, { ok: false, code: 'STORAGE_UNAVAILABLE' });
  }
}
