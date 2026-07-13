/**
 * Vercel API Route: Community Post Actions
 *   POST /api/community-post-actions
 *   Body: { action: 'like'|'unlike'|'reply'|'report'|'delete', postId, ... }
 *
 * 2026-07-12 UIUX 가이드 P9 실전화 백엔드 2/3.
 *   - like/unlike: 로그인 필수. likes/{uid} 서브문서 존재 여부로 멱등 처리 + likeCount 증감.
 *   - reply: 로그인 필수, 500자 한도, 연락처 유도 감지 시 review(미노출). replyCount 증가.
 *   - report: 익명 허용(IP rate limit 5/h). community_reports 저장 + 운영자 텔레그램.
 *   - delete: 본인 글/댓글만 status='deleted' (물리 삭제 X — 신고 추적 보존).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { detectLanguage } from './_shared/translator.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const REPORT_REASONS = new Set(['spam', 'harassment', 'unsafe', 'scam']);
const CONTACT_RE = /(telegram|whats\s*app|kakao\s*talk|카카오톡|카톡|위챗|wechat|line\s*id|instagram\s*dm|\+?\d[\d\s().-]{8,}\d)/i;

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}
const _ok = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

function sanitizeName(raw) {
  const s = String(raw || '').replace(/https?:\/\/\S+/gi, '').replace(/[<>]/g, '').trim();
  return (s || 'Traveler').slice(0, 30);
}

/**
 * 커뮤니티 알림 기록 (2026-07-13 UIUX P1/P9) — 글 작성자의 community_notifications 에 적재.
 * 자기 글에 자기 액션 = 기록 안 함. 실패해도 본 액션 흐름 무영향(fire-and-forget 전용).
 */
async function writeNotification(db, postRef, auth, type, fromName = '') {
  const postDoc = await postRef.get();
  if (!postDoc.exists) return;
  const d = postDoc.data();
  if (!d.authorUid || d.authorUid === auth.uid) return;
  await db.collection('community_notifications').add({
    toUid: d.authorUid,
    type, // 'reply' | 'like'
    postId: postRef.id,
    postTitle: String(d.title || '').slice(0, 80),
    fromName: fromName || 'Traveler',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { action, postId } = body;

    if (!postId || typeof postId !== 'string') return json(res, 400, _err('postId required', 'MISSING_POST_ID'));

    const db = initAdminDb('community-post-actions');
    if (!db) return json(res, 500, _err('Firestore unavailable', 'DB_UNAVAILABLE'));

    const postRef = db.collection('community_posts').doc(postId);

    // ── report: 익명 허용 ──
    if (action === 'report') {
      const reason = String(body.reason || '');
      if (!REPORT_REASONS.has(reason)) return json(res, 400, _err('invalid reason', 'INVALID_REASON'));
      const ipCheck = await checkIpRateLimit({
        db, ip: getClientIp(req), collection: 'community_rate_limits', maxRequests: 5, errorLabel: 'community reports',
      });
      if (!ipCheck.ok) return json(res, ipCheck.status, _err(ipCheck.error, 'RATE_LIMITED'));

      const postDoc = await postRef.get();
      if (!postDoc.exists) return json(res, 404, _err('Post not found', 'NOT_FOUND'));

      const reportRef = await db.collection('community_reports').add({
        postId,
        replyId: typeof body.replyId === 'string' ? body.replyId : null,
        reason,
        status: 'open', // open | reviewed | actioned
        createdAt: FieldValue.serverTimestamp(),
      });
      void notify('booking',
        `🚩 <b>커뮤니티 신고</b>\n사유: ${reason}\n글: ${String(postDoc.data().title || '').slice(0, 60)}\n` +
        `→ <code>community_reports/${reportRef.id}</code> / <code>community_posts/${postId}</code>`
      ).catch(() => {});
      return json(res, 200, _ok({ reportId: reportRef.id }));
    }

    // ── 이하 전부 로그인 필수 ──
    const auth = await verifyUserToken(req);
    if (!auth.ok) return json(res, auth.status, _err(auth.error, 'AUTH_REQUIRED'));

    if (action === 'like' || action === 'unlike') {
      const likeRef = postRef.collection('likes').doc(auth.uid);
      const result = await db.runTransaction(async (tx) => {
        const [postDoc, likeDoc] = await Promise.all([tx.get(postRef), tx.get(likeRef)]);
        if (!postDoc.exists || postDoc.data().status !== 'active') return { error: 'NOT_FOUND' };
        const liked = likeDoc.exists;
        if (action === 'like' && !liked) {
          tx.set(likeRef, { createdAt: FieldValue.serverTimestamp() });
          tx.update(postRef, { likeCount: FieldValue.increment(1) });
          return { likeCount: (postDoc.data().likeCount || 0) + 1, liked: true };
        }
        if (action === 'unlike' && liked) {
          tx.delete(likeRef);
          tx.update(postRef, { likeCount: FieldValue.increment(-1) });
          return { likeCount: Math.max(0, (postDoc.data().likeCount || 0) - 1), liked: false };
        }
        return { likeCount: postDoc.data().likeCount || 0, liked }; // 멱등: 이미 원하는 상태
      });
      if (result.error) return json(res, 404, _err('Post not found', result.error));
      // 알림 (2026-07-13 UIUX P1/P9): 첫 like 만 — 글 작성자에게. 자기 글 제외, fire-and-forget.
      if (action === 'like' && result.liked && result.likeCount) {
        void writeNotification(db, postRef, auth, 'like').catch(() => {});
      }
      return json(res, 200, _ok(result));
    }

    if (action === 'reply') {
      const text = String(body.body || '').trim();
      if (!text || text.length > 500) return json(res, 400, _err('body required (max 500)', 'INVALID_BODY'));
      const uidCheck = await checkIpRateLimit({
        db, ip: `uid:${auth.uid}`, collection: 'community_rate_limits', maxRequests: 10, errorLabel: 'community replies',
      });
      if (!uidCheck.ok) return json(res, uidCheck.status, _err(uidCheck.error, 'RATE_LIMITED'));

      const postDoc = await postRef.get();
      if (!postDoc.exists || postDoc.data().status !== 'active') return json(res, 404, _err('Post not found', 'NOT_FOUND'));

      const needsReview = CONTACT_RE.test(text);
      const lang = await detectLanguage(text);
      const replyRef = await postRef.collection('replies').add({
        body: text,
        lang: ['ko', 'en', 'ja', 'zh'].includes(lang) ? lang : 'en',
        authorUid: auth.uid,
        authorEmail: auth.email,
        authorName: sanitizeName(body.authorName),
        status: needsReview ? 'review' : 'active',
        createdAt: FieldValue.serverTimestamp(),
        translations: {},
      });
      if (!needsReview) {
        await postRef.update({ replyCount: FieldValue.increment(1) });
        // 알림 (2026-07-13): 공개 댓글만 — 글 작성자에게. 자기 댓글 제외, fire-and-forget.
        void writeNotification(db, postRef, auth, 'reply', sanitizeName(body.authorName)).catch(() => {});
      } else void notify('booking', `🛡️ 커뮤니티 댓글 검토 대기 → <code>community_posts/${postId}/replies/${replyRef.id}</code>`).catch(() => {});
      return json(res, 200, _ok({ replyId: replyRef.id, status: needsReview ? 'review' : 'active' }));
    }

    if (action === 'delete') {
      const replyId = typeof body.replyId === 'string' ? body.replyId : null;
      if (replyId) {
        const replyRef = postRef.collection('replies').doc(replyId);
        const replyDoc = await replyRef.get();
        if (!replyDoc.exists) return json(res, 404, _err('Reply not found', 'NOT_FOUND'));
        if (replyDoc.data().authorUid !== auth.uid) return json(res, 403, _err('Not your reply', 'FORBIDDEN'));
        const wasActive = replyDoc.data().status === 'active';
        await replyRef.update({ status: 'deleted' });
        if (wasActive) await postRef.update({ replyCount: FieldValue.increment(-1) });
        return json(res, 200, _ok({ deleted: true }));
      }
      const postDoc = await postRef.get();
      if (!postDoc.exists) return json(res, 404, _err('Post not found', 'NOT_FOUND'));
      if (postDoc.data().authorUid !== auth.uid) return json(res, 403, _err('Not your post', 'FORBIDDEN'));
      await postRef.update({ status: 'deleted' });
      return json(res, 200, _ok({ deleted: true }));
    }

    return json(res, 400, _err('invalid action', 'INVALID_ACTION'));
  } catch (err) {
    console.error('[community-post-actions]', err);
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
