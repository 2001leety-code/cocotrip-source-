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

let _adminDb = null;

(function bootstrap() {
  try {
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
      _adminDb = getAdminFirestore(adminApp);
      _adminDb.settings({ ignoreUndefinedProperties: true });
      logger.debug(`[firebase-admin] initialized OK`);
    } else {
      logger.warn(`[firebase-admin] keys missing or cert() failed — Firestore disabled`);
    }
  } catch (e) {
    logger.error(`[firebase-admin] bootstrap failed: ${e.message}`);
  }
})();

export function initAdminDb(_tag = 'firebase-admin') {
  return _adminDb;
}
