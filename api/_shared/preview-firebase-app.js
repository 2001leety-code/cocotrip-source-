// [preview-firebase:resolver] Shared exact-Preview Firebase app resolver.
// No work at import time; runs only when getPreviewFirebaseApp() is invoked.
// Throws ONLY Errors whose message/code is a fixed code from PREVIEW_FIREBASE_ERRORS.
// Never logs. Returns the same validated app; no Firestore/Auth getters here.
// Preview credentials: FIREBASE_* (primary) or GOOGLE_SERVICE_ACCOUNT_KEY (fallback only
// when primary absent or cert() threw). No ADC, no FIREBASE_SERVICE_ACCOUNT_KEY.

import { createHash } from 'crypto';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import {
  validatePreviewProjectConfig,
  validateServiceAccountProject,
  registerCertCredential,
  registerCreatedApp,
  verifyPreviewApp,
} from './firebase-admin-provenance.js';

export const PREVIEW_FIREBASE_ERRORS = Object.freeze({
  NOT_PREVIEW: 'PREVIEW_FIREBASE_NOT_PREVIEW',
  CONFIG_INVALID: 'PREVIEW_FIREBASE_CONFIG_INVALID',
  CREDENTIAL_MISSING: 'PREVIEW_FIREBASE_CREDENTIAL_MISSING',
  CREDENTIAL_INVALID: 'PREVIEW_FIREBASE_CREDENTIAL_INVALID',
  CREDENTIAL_PROVENANCE: 'PREVIEW_FIREBASE_CREDENTIAL_PROVENANCE',
  APP_REJECTED: 'PREVIEW_FIREBASE_APP_REJECTED',
  INIT_FAILED: 'PREVIEW_FIREBASE_INIT_FAILED',
});
const CODES = new Set(Object.values(PREVIEW_FIREBASE_ERRORS));

class PreviewFirebaseError extends Error {
  constructor(code) { super(code); this.name = 'PreviewFirebaseError'; this.code = code; }
}
const fail = (code) => { throw new PreviewFirebaseError(code); };

export function previewFirebaseErrorCode(e) {
  return e instanceof PreviewFirebaseError && CODES.has(e.code) ? e.code : PREVIEW_FIREBASE_ERRORS.INIT_FAILED;
}

// credential cache: key = source|project|sha256(material) -> registered credential (idempotent across imports)
const _certCache = new Map();
const keyOf = (source, projectId, material) =>
  `${source}|${projectId}|${createHash('sha256').update(material).digest('hex')}`;

function primaryCredential(expected, clientEmail, privateKey) {
  const k = keyOf('firebase-env', expected, `${clientEmail}\n${privateKey}`);
  const hit = _certCache.get(k);
  if (hit) {
    try { registerCertCredential(hit, { projectId: expected, source: 'firebase-env' }); }
    catch (_e) { fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_PROVENANCE); } // no fallback
    return { credential: hit, threw: false };
  }
  let pc;
  try { pc = cert({ projectId: expected, clientEmail, privateKey }); } catch (_e) { return { credential: null, threw: true }; }
  try { registerCertCredential(pc, { projectId: expected, source: 'firebase-env' }); }
  catch (_e) { fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_PROVENANCE); } // no fallback
  _certCache.set(k, pc);
  return { credential: pc, threw: false };
}

function fallbackCredential(expected, raw) {
  const k = keyOf('service-account-key', expected, raw);
  const hit = _certCache.get(k);
  if (hit) {
    try { registerCertCredential(hit, { projectId: expected, source: 'service-account-key' }); }
    catch (_e) { fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_PROVENANCE); }
    return hit;
  }
  let sa;
  try { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  catch (_e) { fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_INVALID); }
  if (!validateServiceAccountProject(sa && sa.project_id, expected).ok) fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_INVALID);
  let fc;
  try { fc = cert(sa); } catch (_e) { fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_INVALID); }
  try { registerCertCredential(fc, { projectId: expected, source: 'service-account-key' }); }
  catch (_e) { fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_PROVENANCE); }
  _certCache.set(k, fc);
  return fc;
}

export function getPreviewFirebaseApp(env = process.env) {
  try {
    if (!env || env.VERCEL_ENV !== 'preview') fail(PREVIEW_FIREBASE_ERRORS.NOT_PREVIEW);
    const cfg = validatePreviewProjectConfig(env);
    if (!cfg.ok) fail(PREVIEW_FIREBASE_ERRORS.CONFIG_INVALID);
    const expected = cfg.projectId;

    // Selected credentials must be valid on every call, even if an app already exists.
    let credential = null;
    const clientEmail = env.FIREBASE_CLIENT_EMAIL || '';
    const privateKey = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const primaryPresent = !!(clientEmail && privateKey);
    let primaryThrew = false;
    if (primaryPresent) {
      const r = primaryCredential(expected, clientEmail, privateKey);
      credential = r.credential;
      primaryThrew = r.threw;
    }
    if (!credential && (!primaryPresent || primaryThrew) && env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      credential = fallbackCredential(expected, env.GOOGLE_SERVICE_ACCOUNT_KEY);
    }
    if (!credential) fail(PREVIEW_FIREBASE_ERRORS.CREDENTIAL_MISSING);

    let app;
    const apps = getApps();
    if (apps.length) {
      app = apps[0]; // default-deny: unregistered/foreign apps are rejected, never adopted
    } else {
      app = initializeApp({ credential, projectId: expected });
      try { registerCreatedApp(app, { credential, projectId: expected }); }
      catch (_e) { fail(PREVIEW_FIREBASE_ERRORS.APP_REJECTED); }
    }
    if (!verifyPreviewApp(app, expected).ok) fail(PREVIEW_FIREBASE_ERRORS.APP_REJECTED);
    return app;
  } catch (e) {
    throw new PreviewFirebaseError(previewFirebaseErrorCode(e));
  }
}
