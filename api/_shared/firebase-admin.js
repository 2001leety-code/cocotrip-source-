// Centralized firebase-admin lazy init for api/* routes.
//
// Why: 5+ files duplicated FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY env
// reads with PEM normalization (BOM strip, quote strip, \n unescape, base64
// reflow). One source of truth removes the risk of one route normalizing keys
// while another doesn't, which produced silent Firestore-disabled failures.
//
// Returns null on missing/invalid creds — callers should treat that as
// "Firestore unavailable, fall back" rather than throw.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { logger } from './log.js';

export function initAdminDb(tag = 'firebase-admin') {
  try {
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();

    // plan-status.js \uD328\uD134\uACFC \uB3D9\uC77C\uD558\uAC8C \uB2E8\uC21C \uBCC0\uD658\uB9CC \uC0AC\uC6A9. \uCD94\uAC00 PEM reformat\uC740 \uC77C\uBD80
    // \uD658\uACBD\uC5D0\uC11C cert() invalid \uC720\uBC1C (Vercel prod 2026-04-29 launch D-1 \uBC1C\uACAC).
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/^\uFEFF/, '')
      .replace(/^["']|["']$/g, '')
      .replace(/\\n/g, '\n')
      .trim();

    logger.debug(`[${tag}] Firebase admin key check:`, {
      projectId: projectId ? 'ok' : 'MISSING',
      clientEmail: clientEmail ? 'ok' : 'MISSING',
      keyLen: privateKey.length,
    });

    let credential = null;
    if (projectId && clientEmail && privateKey) {
      try {
        credential = cert({ projectId, clientEmail, privateKey });
      } catch (e) {
        logger.warn(`[${tag}] cert() with FIREBASE_* failed: ${e.message}`);
      }
    }
    if (!credential && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      // Fallback: base64-encoded service account JSON (used by loyalty/admin routes)
      try {
        const sa = JSON.parse(
          Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8')
        );
        credential = cert(sa);
        logger.debug(`[${tag}] Firebase admin using GOOGLE_SERVICE_ACCOUNT_KEY fallback`);
      } catch (e) {
        logger.warn(`[${tag}] GOOGLE_SERVICE_ACCOUNT_KEY parse failed:`, e.message);
      }
    }

    if (credential) {
      const adminApp = getApps().length ? getApps()[0] : initializeApp({ credential });
      const adminDb = getAdminFirestore(adminApp);
      adminDb.settings({ ignoreUndefinedProperties: true });
      logger.debug(`[${tag}] firebase-admin initialized OK`);
      return adminDb;
    }

    logger.warn(`[${tag}] firebase-admin keys missing — Firestore disabled`);
    return null;
  } catch (e) {
    logger.error(`[${tag}] firebase-admin init failed:`, e.message);
    return null;
  }
}
