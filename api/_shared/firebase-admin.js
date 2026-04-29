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
    // plan-status.js \uD328\uD134\uACFC \uC815\uD655\uD788 \uB3D9\uC77C\uD558\uAC8C. trim() / \uB530\uC634\uD45C \uC81C\uAC70 / BOM \uC81C\uAC70 \uBAA8\uB450
    // \uBE7C\uBC84\uB9B0\uB2E4 \u2014 trim() \uC774 PEM \uB05D \n \uAE4C\uC9C0 \uC81C\uAC70\uD574 cert() invalid (2026-04-29 launch
    // D-1 \uBC1C\uACAC). prod \uC5D0\uC11C \uAC80\uC99D\uB41C \uD615\uD0DC\uB294 \uB2E8\uC21C \\n\u2192\n replace \uD55C \uBC88\uBFD0.
    const projectId = process.env.FIREBASE_PROJECT_ID || '';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

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
