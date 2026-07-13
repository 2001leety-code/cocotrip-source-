/**
 * Vercel API Route: Community Admin Moderation (UIUX P9 실배선, 2026-07-13)
 *   GET  /api/community-admin              — 검토 대기 글(status='review') + 열린 신고 + 통계
 *   POST /api/community-admin              — { action, postId, replyId?, reportId? }
 *     - approve       : 글/댓글 status review→active (댓글 승인 시 replyCount+1)
 *     - hide          : 글/댓글 status →hidden (공개 중이던 댓글이면 replyCount-1)
 *     - resolve_report: 신고 status open→reviewed
 *
 * 이전 상태: /admin/community(CommunityModerationPage)는 하드코딩 샘플 데모였고
 * community_reports 는 적재만 되고 읽는 API 가 없었음 — 이 endpoint 가 그 공백을 채움.
 *
 * 인증: verifyAdminToken (ADMIN_EMAIL / admin claim) — 일반 사용자 403.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAdminToken } from './_shared/admin-auth.js';

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

const toMillis = (ts) => (ts && ts.toMillis ? ts.toMillis() : null);

async function handleGet(req, res, db) {
  // 검토 대기 글 — 단일 필드 where 라 복합 인덱스 불필요.
  const reviewSnap = await db.collection('community_posts')
    .where('status', '==', 'review').limit(50).get();
  const queue = reviewSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      postId: doc.id,
      title: d.title,
      body: d.body,
      lang: d.lang,
      category: d.category,
      authorName: d.authorName,
      authorEmail: d.authorEmail || null, // 어드민 전용 화면 — 반복 신고자 파악용
      images: Array.isArray(d.images) ? d.images : [],
      createdAt: toMillis(d.createdAt),
    };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // 열린 신고 + 대상 글 스냅샷 join
  const reportSnap = await db.collection('community_reports')
    .where('status', '==', 'open').limit(50).get();
  const reports = await Promise.all(reportSnap.docs.map(async (doc) => {
    const d = doc.data();
    let post = null;
    try {
      const postDoc = await db.collection('community_posts').doc(d.postId).get();
      if (postDoc.exists) {
        const p = postDoc.data();
        post = { title: p.title, body: String(p.body || '').slice(0, 300), status: p.status, authorName: p.authorName };
      }
    } catch { /* join 실패 = post null 로 표기 */ }
    return {
      reportId: doc.id,
      postId: d.postId,
      replyId: d.replyId || null,
      reason: d.reason,
      createdAt: toMillis(d.createdAt),
      post,
    };
  }));
  reports.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return json(res, 200, _ok({
    queue,
    reports,
    stats: { pendingReview: queue.length, openReports: reports.length },
  }));
}

async function handlePost(req, res, db) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const action = String(body.action || '');

  if (action === 'resolve_report') {
    const reportId = String(body.reportId || '');
    if (!reportId) return json(res, 400, _err('reportId required', 'MISSING_REPORT_ID'));
    const ref = db.collection('community_reports').doc(reportId);
    const doc = await ref.get();
    if (!doc.exists) return json(res, 404, _err('Report not found', 'NOT_FOUND'));
    await ref.update({ status: 'reviewed', reviewedAt: FieldValue.serverTimestamp() });
    return json(res, 200, _ok({ reportId, status: 'reviewed' }));
  }

  if (action !== 'approve' && action !== 'hide') {
    return json(res, 400, _err('invalid action', 'INVALID_ACTION'));
  }

  const postId = String(body.postId || '');
  if (!postId) return json(res, 400, _err('postId required', 'MISSING_POST_ID'));
  const postRef = db.collection('community_posts').doc(postId);
  const replyId = typeof body.replyId === 'string' && body.replyId ? body.replyId : null;
  const nextStatus = action === 'approve' ? 'active' : 'hidden';

  if (replyId) {
    const replyRef = postRef.collection('replies').doc(replyId);
    const replyDoc = await replyRef.get();
    if (!replyDoc.exists) return json(res, 404, _err('Reply not found', 'NOT_FOUND'));
    const prev = replyDoc.data().status;
    if (prev === nextStatus) return json(res, 200, _ok({ postId, replyId, status: nextStatus })); // 멱등
    await replyRef.update({ status: nextStatus, moderatedAt: FieldValue.serverTimestamp() });
    // 공개 카운트 정합: review/hidden→active = +1, active→hidden = -1
    if (nextStatus === 'active' && prev !== 'active') {
      await postRef.update({ replyCount: FieldValue.increment(1) });
    } else if (prev === 'active' && nextStatus !== 'active') {
      await postRef.update({ replyCount: FieldValue.increment(-1) });
    }
    return json(res, 200, _ok({ postId, replyId, status: nextStatus }));
  }

  const postDoc = await postRef.get();
  if (!postDoc.exists) return json(res, 404, _err('Post not found', 'NOT_FOUND'));
  await postRef.update({ status: nextStatus, moderatedAt: FieldValue.serverTimestamp() });
  return json(res, 200, _ok({ postId, status: nextStatus }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  try {
    const auth = await verifyAdminToken(req);
    if (!auth.ok) return json(res, auth.status, _err(auth.error, 'ADMIN_AUTH_REQUIRED'));

    const db = initAdminDb('community-admin');
    if (!db) return json(res, 500, _err('Firestore unavailable', 'DB_UNAVAILABLE'));
    if (req.method === 'GET') return await handleGet(req, res, db);
    if (req.method === 'POST') return await handlePost(req, res, db);
    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  } catch (err) {
    console.error('[community-admin]', err);
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
