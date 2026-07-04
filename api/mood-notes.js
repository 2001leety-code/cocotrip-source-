/**
 * /api/mood-notes — 운영자 개인 스케줄 메모 (캘린더 날짜별, 운영자 전용)
 *
 * MOOD 포털 공유 캘린더에서 날짜를 클릭해 운영자 본인 스케줄을 적는 기능 (2026-07-05).
 *
 * 🔒 접근: allowlist.admins(운영자)만 — 무드(광고사) 계정은 읽기/쓰기 모두 403.
 *    프론트도 data.isAdmin 일 때만 메모 UI 를 렌더하지만, 진짜 게이트는 여기 서버.
 *    (mood-settle/topup 과 동일한 isAdminEmail 게이트.)
 *
 * GET  ?month=YYYY-MM       → { ok, notes: { 'YYYY-MM-DD': text } }
 * POST { date, text }       → upsert mood_schedule_notes/{date}. text 빈문자면 삭제.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, POST, OPTIONS';
const COLLECTION = 'mood_schedule_notes';
const MAX_TEXT_LEN = 2000;

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') { res.writeHead(200, JSON_HEADERS); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET/POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }

  try {
    const db = initAdminDb('mood-notes');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // 🔒 운영자 전용 — 무드 계정은 조회조차 불가 (개인 스케줄이라 공유 안 함).
    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, auth.email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '운영자 전용 기능입니다.' }));
    }

    if (req.method === 'GET') {
      const month = String(req.query?.month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'month=YYYY-MM 필수' }));
      }
      const snap = await db.collection(COLLECTION).where('month', '==', month).get();
      const notes = {};
      snap.forEach((doc) => {
        const d = doc.data() || {};
        if (typeof d.text === 'string' && d.text) notes[doc.id] = d.text;
      });
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, notes }));
    }

    // POST — upsert / delete
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const date = String(body.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'date=YYYY-MM-DD 필수' }));
    }
    const text = String(body.text || '').slice(0, MAX_TEXT_LEN).trim();

    const ref = db.collection(COLLECTION).doc(date);
    if (!text) {
      await ref.delete();
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, deleted: true }));
    }
    await ref.set({
      text,
      month: date.slice(0, 7),
      byEmail: auth.email,
      updatedAt: Date.now(),
    }, { merge: true });
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    captureError(e, { api: 'mood-notes' });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
