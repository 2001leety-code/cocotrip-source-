/**
 * /api/admin-decisions — 의사결정 큐 (자가운영 에이전시 P5).
 *   GET  → pending 결정 목록 (최신순).
 *   POST {id, action:'approve'|'reject'} → 상태 변경.
 * verifyAdminToken 인증. 상태 변경만(자동 실행 X) = 사람 승인 층.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { resolveDecision, DECISION_COLLECTION } from './_shared/decisionQueue.js';

export const config = { maxDuration: 15 };
const CORS_METHODS = 'GET,POST,OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) return json(req, res, auth.status, { error: auth.error, code: 'AUTH_FAILED' });

  const db = initAdminDb('admin-decisions');
  if (!db) return json(req, res, 503, { error: 'Firestore not configured' });

  try {
    if (req.method === 'GET') {
      const snap = await db.collection(DECISION_COLLECTION).where('status', '==', 'pending').limit(50).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));
      return json(req, res, 200, { items, count: items.length });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const id = body && body.id;
      const status = body && body.action === 'approve' ? 'approved' : body && body.action === 'reject' ? 'rejected' : null;
      if (!id || !status) return json(req, res, 400, { error: 'id + action(approve|reject) 필요' });
      const r = await resolveDecision(db, id, status);
      if (!r.ok) return json(req, res, 500, { error: r.reason });
      return json(req, res, 200, { ok: true, id, status });
    }

    return json(req, res, 405, { error: 'Method Not Allowed' });
  } catch (e) {
    console.error('[admin-decisions]', e && e.message);
    return json(req, res, 500, { error: e && e.message });
  }
}
