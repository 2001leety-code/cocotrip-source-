import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { initAdminDb } from './_shared/firebase-admin.js';

const YEAR_RE = /^20\d{2}$/;
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,90}[a-z0-9])?-[a-f0-9]{12}\.webp$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseBlogImagePath(query = {}) {
  const year = String(firstQueryValue(query.year) || '').trim();
  const name = String(firstQueryValue(query.name) || '').trim();
  if (!YEAR_RE.test(year) || !NAME_RE.test(name)) return null;
  return `blog-images/${year}/${name}`;
}

function resolveBucketName() {
  const explicit = String(
    process.env.FIREBASE_STORAGE_BUCKET
      || process.env.VITE_FIREBASE_STORAGE_BUCKET
      || '',
  ).trim();
  if (explicit) return explicit;

  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  return projectId ? `${projectId}.firebasestorage.app` : '';
}

async function loadBlogImage(path) {
  const db = initAdminDb('blog-image');
  const app = getApps()[0];
  const bucketName = resolveBucketName();
  if (!db || !app || !bucketName) {
    const err = new Error('blog image storage unavailable');
    err.statusCode = 503;
    throw err;
  }

  const file = getStorage(app).bucket(bucketName).file(path);
  const [metadata] = await file.getMetadata();
  const contentType = String(metadata.contentType || '').toLowerCase();
  const size = Number(metadata.size || 0);
  if (contentType !== 'image/webp' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    const err = new Error('invalid blog image metadata');
    err.statusCode = 404;
    throw err;
  }

  return {
    bytes: async () => {
      const [body] = await file.download();
      if (!Buffer.isBuffer(body) || body.length !== size) {
        const err = new Error('blog image size mismatch');
        err.statusCode = 502;
        throw err;
      }
      return body;
    },
    contentType,
    size,
    etag: String(metadata.etag || ''),
  };
}

function sendError(res, statusCode) {
  res.statusCode = statusCode;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(statusCode === 404 ? 'Not found' : 'Image unavailable');
}

export async function serveBlogImage(req, res, loadImage = loadBlogImage) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendError(res, 405);
    return;
  }

  const path = parseBlogImagePath(req.query);
  if (!path) {
    sendError(res, 404);
    return;
  }

  try {
    const image = await loadImage(path);
    const requestEtag = String(req.headers?.['if-none-match'] || '');
    if (image.etag && requestEtag === image.etag) {
      res.statusCode = 304;
      res.setHeader('ETag', image.etag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      res.end();
      return;
    }

    res.statusCode = 200;
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Content-Length', String(image.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (image.etag) res.setHeader('ETag', image.etag);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(await image.bytes());
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.code) === 404 ? 404 : 503;
    sendError(res, statusCode);
  }
}

export default async function handler(req, res) {
  await serveBlogImage(req, res);
}
