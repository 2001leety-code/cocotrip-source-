/**
 * Vercel API Route: Community Notifications (2026-07-13 UIUX P1/P9 알림 MVP)
 *   GET  /api/community-notifications          — 내 알림 최신 30건 + unread 수 (로그인 필수)
 *   POST /api/community-notifications          — { action: 'markAllRead' } (로그인 필수)
 *
 * 데이터 소스: community_notifications (community-post-actions 의 reply/like 가 적재).
 * where(toUid)+orderBy(createdAt) 복합 인덱스 회피 — toUid 필터 후 메모리 정렬(MVP 규모,
 * 사용자당 알림 수백 건 이하 전제. 규모 커지면 인덱스 추가).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}
const _ok = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  try {
    const auth = await verifyUserToken(req);
    if (!auth.ok) return json(res, auth.status, _err(auth.error, 'AUTH_REQUIRED'));

    const db = initAdminDb('community-notifications');
    if (!db) return json(res, 500, _err('Firestore unavailable', 'DB_UNAVAILABLE'));

    const col = db.collection('community_notifications');

    if (req.method === 'GET') {
      const snap = await col.where('toUid', '==', auth.uid).limit(200).get();
      const items = snap.docs
        .map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            type: d.type,
            postId: d.postId,
            postTitle: d.postTitle || '',
            fromName: d.fromName || 'Traveler',
            read: !!d.read,
            createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30);
      const unread = items.filter((i) => !i.read).length;
      return json(res, 200, _ok({ items, unread }));
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      if ((body && body.action) !== 'markAllRead') return json(res, 400, _err('invalid action', 'INVALID_ACTION'));
      const snap = await col.where('toUid', '==', auth.uid).where('read', '==', false).limit(300).get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.update(doc.ref, { read: true }));
      await batch.commit();
      return json(res, 200, _ok({ marked: snap.size }));
    }

    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  } catch (err) {
    console.error('[community-notifications]', err);
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
