/**
 * DELETE /api/plan-delete
 * Body: { planId, uid }
 * Deletes plans/{planId} and users/{uid}/plans/{planId} if uid matches
 */
import { initAdminDb } from './_shared/firebase-admin.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const adminDb = initAdminDb('plan-delete');

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'DELETE') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method Not Allowed', 'METHOD_NOT_ALLOWED')));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const { planId, uid } = body;
  if (!planId) {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify(_err('planId required', 'MISSING_FIELDS')));
  }

  if (!adminDb) {
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err('Firebase not configured', 'CONFIG_ERROR')));
  }

  try {
    // Verify ownership
    const planDoc = await adminDb.collection('plans').doc(planId).get();
    if (!planDoc.exists) {
      res.writeHead(404, JSON_CORS);
      return res.end(JSON.stringify(_err('Plan not found', 'NOT_FOUND')));
    }

    const planData = planDoc.data();
    if (uid && planData.uid !== uid) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err('Permission denied', 'FORBIDDEN')));
    }

    // Delete plan
    await adminDb.collection('plans').doc(planId).delete();

    // Delete user reference if uid provided
    if (uid) {
      try {
        await adminDb.collection('users').doc(uid).collection('plans').doc(planId).delete();
      } catch (e) {
        console.warn('[plan-delete] User plan ref delete failed:', e.message);
      }
    }

    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({ planId })));
  } catch (err) {
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
