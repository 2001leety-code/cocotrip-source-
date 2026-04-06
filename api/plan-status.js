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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  const { planId } = req.query || {};
  if (!planId) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'planId required' }));
  }

  if (!adminDb) {
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Firebase not configured' }));
  }

  try {
    const doc = await adminDb.collection('plans').doc(planId).get();
    if (!doc.exists) {
      res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Plan not found' }));
    }
    const data = doc.data();
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      planId,
      status: data.status || 'unknown',
      createdAt: data.createdAt || null,
      tourTitle: data.itinerary?.tour_title || null,
      area: data.input?.area || null,
    }));
  } catch (err) {
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
