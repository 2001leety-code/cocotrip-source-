/**
 * api/reviews.js — 리뷰 CRUD + 리워드 (+50 Trip Coins)
 * 
 * Actions:
 *   create  — 리뷰 작성 (중복 방지 + 소유자 차단 + +50 코인)
 *   list    — 리뷰 목록 (무인증 가능, 페이지네이션)
 *   delete  — 리뷰 삭제 (작성자 or 어드민)
 *   report  — 리뷰 신고
 */

// ── 표준 응답 래퍼 (api/_shared/response.js와 동일 형식) ──────────
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const ADMIN_EMAILS = ['2001leety@gmail.com'];
const MAX_TEXT = 500;
const MAX_PHOTOS = 3;
const REVIEW_REWARD = 50;

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

async function getFirestore() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore: gfs } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    let credential = null;

    // 방법 1: 개별 환경변수 (loyalty.js 동일 패턴)
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
    let rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/^\uFEFF/, '')
      .replace(/\\n/g, '\n')
      .trim();
    if (rawKey.startsWith('"')) rawKey = JSON.parse(rawKey);

    if (projectId && clientEmail && rawKey) {
      credential = cert({ projectId, clientEmail, privateKey: rawKey });
    }

    // 방법 2: base64 JSON (fallback)
    if (!credential && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
      credential = cert(sa);
    }

    if (credential) {
      initializeApp({ credential });
    } else {
      throw new Error('No Firebase credentials found');
    }
  }
  return { db: gfs() };
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('POST only', 'METHOD_NOT_ALLOWED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch { body = {}; }
    body = body || {};

    const { action } = body;
    const { db } = await getFirestore();

    // ════════════════════════════════════════════════════════
    // ACTION: create — 리뷰 작성
    // ════════════════════════════════════════════════════════
    if (action === 'create') {
      const { userId, targetType, targetId, rating, text, photos, authorName, authorPhotoURL, language, bookingId } = body;
      let { driverChatId, driverName } = body;

      // bookingId만 있고 driver 정보가 없으면 booking 문서에서 자동 채움.
      // 이유: 클라이언트가 항상 driver 정보를 들고 있지 않음 (이메일 → 후기 링크
      // 흐름에서는 bookingId만 query string으로 전달). booking-processor가 배차
      // 수락 시점에 bookings/{orderID}.driver / driverChatId 를 채워두므로 여기서
      // lookup 가능. lookup 실패는 무시 (선택 필드이므로 리뷰 생성 자체를
      // 막지 않음).
      if (bookingId && (!driverChatId || !driverName)) {
        try {
          const bSnap = await db.collection('bookings').doc(String(bookingId)).get();
          if (bSnap.exists) {
            const b = bSnap.data() || {};
            if (!driverChatId && b.driverChatId) driverChatId = b.driverChatId;
            if (!driverName && b.driver) driverName = b.driver;
          }
        } catch (e) {
          console.warn('[reviews] driver lookup 실패 (무시):', e.message);
        }
      }

      // 필수 필드 검증
      if (!userId || !targetType || !targetId || !rating) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing required fields', 'MISSING_FIELDS')));
      }
      if (rating < 1 || rating > 5) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Rating must be 1-5', 'INVALID_RATING')));
      }
      if (text && text.length > MAX_TEXT) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err(`Text max ${MAX_TEXT} characters`, 'TEXT_TOO_LONG')));
      }
      if (photos && photos.length > MAX_PHOTOS) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err(`Max ${MAX_PHOTOS} photos`, 'TOO_MANY_PHOTOS')));
      }

      // 소유자 작성 차단 (plan인 경우)
      if (targetType === 'plan') {
        const planSnap = await db.collection('plans').doc(targetId).get();
        if (planSnap.exists && planSnap.data().uid === userId) {
          res.writeHead(403, JSON_CORS);
          return res.end(JSON.stringify(_err('Cannot review your own plan', 'SELF_REVIEW')));
        }
      }

      // 중복 리뷰 체크
      const existing = await db.collection('reviews')
        .where('authorUid', '==', userId)
        .where('targetId', '==', targetId)
        .limit(1)
        .get();
      if (!existing.empty) {
        res.writeHead(409, JSON_CORS);
        return res.end(JSON.stringify(_err('alreadyReviewed', 'DUPLICATE_REVIEW')));
      }

      // 트랜잭션: 리뷰 생성 + 리워드
      const userRef = db.collection('users').doc(userId);
      const reviewRef = db.collection('reviews').doc();
      const now = Date.now();

      const result = await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const currentCoins = userSnap.exists ? (userSnap.data().tripCoins || 0) : 0;

        // 리뷰 생성
        // driverChatId / driverName / bookingId: 선택 필드 — 기사별 평점 집계용
        // (배차 → 운행 → 리뷰 요청 흐름에서 booking-processor가 채워서 전달)
        tx.set(reviewRef, {
          authorUid: userId,
          authorName: authorName || 'Anonymous',
          authorPhotoURL: authorPhotoURL || null,
          targetType,
          targetId,
          rating: Number(rating),
          text: (text || '').slice(0, MAX_TEXT),
          photos: (photos || []).slice(0, MAX_PHOTOS),
          language: language || 'en',
          ...(driverChatId ? { driverChatId: Number(driverChatId) } : {}),
          ...(driverName ? { driverName } : {}),
          ...(bookingId ? { bookingId } : {}),
          // 자동 필터: URL 포함 시 자동 reported (스팸 의심) §6.2
          status: /https?:\/\/|www\./i.test(text || '') ? 'reported' : 'published',
          createdAt: now,
          updatedAt: now,
        });

        // 리워드 중복 방지 마커
        const rewardRef = db.collection('users').doc(userId).collection('reviewRewards').doc(reviewRef.id);
        tx.set(rewardRef, { rewarded: true, rewardedAt: now, coins: REVIEW_REWARD });

        // 코인 지급
        const newBalance = currentCoins + REVIEW_REWARD;
        tx.update(userRef, { tripCoins: newBalance });

        // 포인트 이력
        const logRef = db.collection('users').doc(userId).collection('pointHistory').doc();
        tx.set(logRef, {
          type: 'earn',
          amount: REVIEW_REWARD,
          balance: newBalance,
          description: `Review reward (+${REVIEW_REWARD} coins)`,
          createdAt: now,
        });

        return { reviewId: reviewRef.id, newBalance };
      });

      console.log('[reviews] created:', result.reviewId, 'by', userId);
      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ ...result, reward: REVIEW_REWARD })));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: list — 리뷰 목록 (무인증)
    // ════════════════════════════════════════════════════════
    if (action === 'list') {
      const { targetType, targetId, limit: rawLimit, cursor } = body;
      const pageSize = Math.min(Number(rawLimit) || 20, 50);

      let query = db.collection('reviews')
        .where('status', '==', 'published')
        .orderBy('createdAt', 'desc')
        .limit(pageSize);

      if (targetType) query = query.where('targetType', '==', targetType);
      if (targetId) query = query.where('targetId', '==', targetId);
      if (cursor) query = query.startAfter(Number(cursor));

      const snap = await query.get();
      const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nextCursor = reviews.length === pageSize ? reviews[reviews.length - 1].createdAt : null;

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ reviews, nextCursor, count: reviews.length })));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: my-reviews — 내 리뷰 목록 (서버사이드 필터)
    // ════════════════════════════════════════════════════════
    if (action === 'my-reviews') {
      const { userId } = body;
      if (!userId) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing userId', 'MISSING_FIELDS')));
      }

      const snap = await db.collection('reviews')
        .where('authorUid', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ reviews, count: reviews.length })));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: admin-list — 신고된 리뷰 (어드민 전용)
    // ════════════════════════════════════════════════════════
    if (action === 'admin-list') {
      const { userEmail, filter } = body;
      if (!ADMIN_EMAILS.includes((userEmail || '').toLowerCase())) {
        res.writeHead(403, JSON_CORS);
        return res.end(JSON.stringify(_err('Admin only', 'FORBIDDEN')));
      }

      let query;
      if (filter === 'hidden') {
        query = db.collection('reviews')
          .where('status', '==', 'hidden')
          .orderBy('updatedAt', 'desc')
          .limit(50);
      } else if (filter === 'all') {
        query = db.collection('reviews')
          .orderBy('createdAt', 'desc')
          .limit(100);
      } else {
        // default: reported
        query = db.collection('reviews')
          .where('status', '==', 'reported')
          .orderBy('reportedAt', 'desc')
          .limit(50);
      }

      const snap = await query.get();
      const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ reviews, count: reviews.length })));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: delete — 리뷰 삭제 (작성자 or 어드민)
    // ════════════════════════════════════════════════════════
    if (action === 'delete') {
      const { reviewId, userId, userEmail } = body;
      if (!reviewId) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing reviewId', 'MISSING_FIELDS')));
      }

      const reviewRef = db.collection('reviews').doc(reviewId);
      const reviewSnap = await reviewRef.get();
      if (!reviewSnap.exists) {
        res.writeHead(404, JSON_CORS);
        return res.end(JSON.stringify(_err('Review not found', 'NOT_FOUND')));
      }

      const review = reviewSnap.data();
      const isAuthor = review.authorUid === userId;
      const isAdmin = ADMIN_EMAILS.includes((userEmail || '').toLowerCase());

      if (!isAuthor && !isAdmin) {
        res.writeHead(403, JSON_CORS);
        return res.end(JSON.stringify(_err('Not authorized', 'FORBIDDEN')));
      }

      await reviewRef.delete();
      console.log('[reviews] deleted:', reviewId, 'by', userId);

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ deleted: reviewId })));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: report — 리뷰 신고
    // ════════════════════════════════════════════════════════
    if (action === 'report') {
      const { reviewId, reason, userId: reporterUid } = body;
      if (!reviewId) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing reviewId', 'MISSING_FIELDS')));
      }

      const { FieldValue } = await import('firebase-admin/firestore');
      const reviewRef = db.collection('reviews').doc(reviewId);
      await reviewRef.update({
        status: 'reported',
        reportReason: reason || '',
        reportedBy: reporterUid || 'anonymous',
        reportedAt: Date.now(),
        // 신고 사유 배열 추가 (§6.2)
        reports: FieldValue.arrayUnion({
          reporterUid: reporterUid || 'anonymous',
          reason: reason || '',
          createdAt: Date.now(),
        }),
      });

      console.log('[reviews] reported:', reviewId);
      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ reported: reviewId })));
    }

    // ════════════════════════════════════════════════════════
    // ACTION: moderate — 어드민 모더레이션 (keep/hide/delete)
    // ════════════════════════════════════════════════════════
    if (action === 'moderate') {
      const { reviewId, decision, userEmail } = body;
      if (!ADMIN_EMAILS.includes((userEmail || '').toLowerCase())) {
        res.writeHead(403, JSON_CORS);
        return res.end(JSON.stringify(_err('Admin only', 'FORBIDDEN')));
      }
      if (!reviewId || !['keep', 'hide', 'delete'].includes(decision)) {
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err('Missing reviewId or invalid decision', 'INVALID_INPUT')));
      }

      const reviewRef = db.collection('reviews').doc(reviewId);

      if (decision === 'delete') {
        await reviewRef.delete();
        console.log('[reviews] admin deleted:', reviewId);
      } else {
        const newStatus = decision === 'keep' ? 'published' : 'hidden';
        await reviewRef.update({
          status: newStatus,
          moderatedBy: userEmail,
          moderatedAt: Date.now(),
          updatedAt: Date.now(),
        });
        console.log(`[reviews] admin ${decision}:`, reviewId);
      }

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({ reviewId, decision })));
    }

    // Unknown action
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify(_err(`Unknown action: ${action}`, 'UNKNOWN_ACTION')));

  } catch (err) {
    console.error('[reviews] Error:', err);
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
