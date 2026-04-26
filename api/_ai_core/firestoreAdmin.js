/**
 * firebase-admin lazy initializer for server routes.
 *
 * The private key is often pasted into environment variables with quoting
 * and line-break artefacts (BOM, wrapping quotes, \n escapes), so we
 * normalize the PEM before calling cert().
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { logger } from '../_shared/log.js';

export function initAdminDb() {
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

    logger.debug('[firestoreAdmin] Key:', {
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
      logger.debug('[firestoreAdmin] firebase-admin initialized OK');
      return adminDb;
    }

    logger.warn('[firestoreAdmin] firebase-admin keys missing — Firestore disabled');
    return null;
  } catch (e) {
    logger.error('[firestoreAdmin] firebase-admin init failed:', e.message);
    return null;
  }
}
