/**
 * GET /api/plan-status?planId=xxx
 * Returns plan status from Firestore
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

let adminDb = null;
try {
  const projectId = process.env.FIREBASE_PROJECT_ID || '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    const adminApp = getApps().length ? getApps()[0] : initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    adminDb = getAdminFirestore(adminApp);
  }
} catch (e) { console.warn('[plan-status] Firebase init error:', e.message); }

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method Not Allowed', 'METHOD_NOT_ALLOWED')));
  }

  const { planId } = req.query || {};
  if (!planId) {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify(_err('planId required', 'MISSING_FIELDS')));
  }

  if (!adminDb) {
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err('Firebase not configured', 'CONFIG_ERROR')));
  }

  try {
    const doc = await adminDb.collection('plans').doc(planId).get();
    if (!doc.exists) {
      res.writeHead(404, JSON_CORS);
      return res.end(JSON.stringify(_err('Plan not found', 'NOT_FOUND')));
    }
    const data = doc.data();
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({
      planId,
      status: data.status || 'unknown',
      // P206: days 수 추가 — measure script 가 plan 완성도 확인 가능
      days: (data.itinerary?.days || []).length,
      _streaming_in_progress: data._streaming_in_progress !== undefined ? data._streaming_in_progress : null,
      createdAt: data.createdAt || null,
      tourTitle: data.itinerary?.tour_title || null,
      area: data.input?.area || null,
    })));
  } catch (err) {
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
