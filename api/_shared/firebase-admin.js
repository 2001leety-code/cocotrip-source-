// Centralized firebase-admin init for api/* routes.
//
// Module-level one-time init (plan-status.js 패턴) — Vercel serverless 인스턴스
// 별로 일관되게 동작하도록 모듈 import 시점에 1회 init. lazy init 패턴은 일부
// instance에서 cert() throw → null 반환되며 같은 instance가 그 후 호출에도
// 영원히 fail (2026-04-29 launch D-1, my-bookings 5/5 중 1개만 ok 사례).
//
// Returns null on missing/invalid creds — callers should throw "Firestore
// unavailable" or fall back gracefully.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { logger } from './log.js';
// 🔴 2026-07-29: Preview 배포가 운영 Firebase 를 그대로 쓰면 테스트 결제가 운영
//   예약·포인트를 실제로 쓴다. 부팅 시 1회 검사한다(기본 warn, enforce 시 중단).
import { assertFirebaseEnvMatch } from './firebase-env-guard.js';

let _adminDb = null;
let _adminApp = null;
let _previewState = { isolated: false, projectId: null };

export function isIsolatedPreview() {
  return process.env.VERCEL_ENV === 'preview';
}

export const PREVIEW_FIREBASE_PROJECT = 'cocotrip-preview-2026';

function assertPreviewProject(projectId) {
  if (projectId !== PREVIEW_FIREBASE_PROJECT
    || projectId === process.env.FIREBASE_PRODUCTION_PROJECT_ID) {
    throw new Error('PREVIEW_FIREBASE_TARGET_MISMATCH');
  }
}

function assertPreviewCredential(credential) {
  assertPreviewProject(credential && credential.projectId);
  if (!credential.clientEmail || !credential.clientEmail.endsWith('@' + PREVIEW_FIREBASE_PROJECT + '.iam.gserviceaccount.com')) {
    throw new Error('PREVIEW_FIREBASE_CREDENTIAL_MISMATCH');
  }
}

function bootstrapPreview() {
  assertPreviewProject(process.env.FIREBASE_PROJECT_ID);
  if (process.env.FIREBASE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST
    || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('PREVIEW_FIREBASE_EMULATOR_FORBIDDEN');
  }
  let app = getApps().find((candidate) => candidate.name === '[DEFAULT]');
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    let serviceAccount;
    if (projectId && clientEmail && privateKey) {
      serviceAccount = { projectId, clientEmail, privateKey };
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const raw = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
      serviceAccount = { projectId: raw.project_id || raw.projectId, clientEmail: raw.client_email || raw.clientEmail, privateKey: raw.private_key || raw.privateKey };
    } else {
      throw new Error('PREVIEW_FIREBASE_CREDENTIAL_MISSING');
    }
    assertPreviewCredential(serviceAccount);
    const credential = cert(serviceAccount);
    assertPreviewCredential(credential);
    app = initializeApp({ credential, projectId: PREVIEW_FIREBASE_PROJECT });
  }
  assertPreviewProject(app.options && app.options.projectId);
  assertPreviewCredential(app.options && app.options.credential);
  const db = getAdminFirestore(app);
  assertPreviewProject(db.projectId);
  db.settings({ ignoreUndefinedProperties: true });
  _adminApp = app;
  _adminDb = db;
  _previewState = { isolated: true, projectId: db.projectId };
  logger.info('[firebase-admin] Preview isolation verified', _previewState);
}

export function initAdminApp() {
  return _adminApp;
}

export function previewFirebaseState() {
  return { ..._previewState };
}

(function bootstrap() {
  try {
    if (isIsolatedPreview()) {
      bootstrapPreview();
      return;
    }
    assertFirebaseEnvMatch('firebase-admin');
    const projectId = process.env.FIREBASE_PROJECT_ID || '';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    let credential = null;
    if (projectId && clientEmail && privateKey) {
      try {
        credential = cert({ projectId, clientEmail, privateKey });
      } catch (e) {
        logger.warn(`[firebase-admin] cert() with FIREBASE_* failed: ${e.message}`);
      }
    }
    if (!credential && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        const sa = JSON.parse(
          Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8')
        );
        credential = cert(sa);
      } catch (e) {
        logger.warn(`[firebase-admin] GOOGLE_SERVICE_ACCOUNT_KEY parse failed: ${e.message}`);
      }
    }

    if (credential) {
      const adminApp = getApps().length ? getApps()[0] : initializeApp({ credential });
      _adminApp = adminApp;
      _adminDb = getAdminFirestore(adminApp);
      _adminDb.settings({ ignoreUndefinedProperties: true });
      logger.debug(`[firebase-admin] initialized OK`);
    } else {
      logger.warn(`[firebase-admin] keys missing or cert() failed — Firestore disabled`);
    }
  } catch (e) {
    _adminDb = null;
    _adminApp = null;
    logger.error(isIsolatedPreview() ? '[firebase-admin] Preview isolation blocked' : `[firebase-admin] bootstrap failed: ${e.message}`);
  }
})();

export function initAdminDb(_tag = 'firebase-admin') {
  return _adminDb;
}
