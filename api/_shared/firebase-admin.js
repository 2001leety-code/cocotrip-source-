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

    const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/^\uFEFF/, '')
      .replace(/^["']|["']$/g, '')
      .replace(/\\n/g, '\n')
      .trim();

    let privateKey = '';
    const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
    if (pemMatch) {
      const base64Clean = pemMatch[1].replace(/\s+/g, '');
      const lines = base64Clean.match(/.{1,64}/g) || [];
      privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
    } else {
      privateKey = rawKey;
    }

    logger.debug(`[${tag}] Firebase admin key check:`, {
      projectId: projectId ? 'ok' : 'MISSING',
      clientEmail: clientEmail ? 'ok' : 'MISSING',
      keyLen: privateKey.length,
      pem: !!pemMatch,
    });

    if (projectId && clientEmail && privateKey) {
      const adminApp = getApps().length ? getApps()[0] : initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
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
