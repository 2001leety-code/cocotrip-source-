/**
 * GET /api/admin-ai-ops-center
 *
 * 예약·문의·CS·결제 검토·자동화 재시도 상태를 한 화면에서 읽기 위한 관리자 전용
 * read model. 어떤 컬렉션도 쓰지 않으며, 한 원본이 실패해도 나머지 원본은 반환한다.
 * 응답에는 고객 이름·이메일·전화번호를 넣지 않는다.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import {
  dedupeConfirmedPendingMirrors,
  normalizeCsTicket,
  normalizeDecision,
  normalizeInquiry,
  normalizePaymentReview,
  normalizeReservation,
  publicReservation,
  retryQueueHealth,
  summarizeOps,
} from './_shared/adminAiOpsAggregate.js';

export const maxDuration = 20;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, OPTIONS';
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 250;
const GITHUB_ACTIONS_URL = 'https://github.com/2001leety-code/cocotrip-source-/actions';

const SOURCE_LABELS = Object.freeze({
  bookings: '온라인·정식 예약',
  pending_bookings: '입금 대기 예약',
  mood_bookings: 'MOOD 예약',
  charter_inquiries: '차터·맞춤 문의',
  pending_free_claims: '무료 플랜 신청',
  cs_tickets: 'CS 문의',
  payment_reviews: '결제 격리',
  decision_queue: '결정 대기',
  runtime_flags: '자동응대 설정',
  pending_processor_retries: '예약 후속처리 재시도',
  pending_email_retries: '고객 이메일 재시도',
  pending_ai_planner_retries: 'AI 플래너 재시도',
});

function json(req, res, status, body) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, { methods: CORS_METHODS }),
  });
  return res.end(JSON.stringify(body));
}

function docs(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function sourceState(key, result, limit) {
  if (result.status === 'rejected') {
    return {
      key,
      label: SOURCE_LABELS[key] || key,
      ok: false,
      count: 0,
      possiblyTruncated: false,
    };
  }
  const value = result.value;
  const count = value && Array.isArray(value.docs) ? value.docs.length : value && value.exists ? 1 : 0;
  return {
    key,
    label: SOURCE_LABELS[key] || key,
    ok: true,
    count,
    possiblyTruncated: count >= limit,
  };
}

function resultDocs(key, result, failures) {
  if (result.status === 'fulfilled') return docs(result.value);
  failures.push(key);
  console.error(`[admin-ai-ops-center] ${key} read failed:`, result.reason && result.reason.message);
  return [];
}

function retryDocs(key, result, failures) {
  return resultDocs(key, result, failures).map((row) => ({ id: row.id, ...row.data }));
}

function recent(db, collectionName, limit) {
  return db.collection(collectionName).orderBy('createdAt', 'desc').limit(limit).get();
}

function activeRetries(db, collectionName, limit) {
  return db.collection(collectionName)
    .where('status', 'in', ['pending', 'manual-intervention', 'permanent-failure'])
    .limit(limit)
    .get();
}

function compareReservations(a, b) {
  const aFuture = a.tripAtMs > Date.now();
  const bFuture = b.tripAtMs > Date.now();
  if (aFuture && bFuture && a.tripAtMs !== b.tripAtMs) return a.tripAtMs - b.tripAtMs;
  if (aFuture !== bFuture) return aFuture ? -1 : 1;
  return b.updatedAtMs - a.updatedAtMs;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS }));
    return res.end();
  }
  if (req.method !== 'GET') {
    return json(req, res, 405, { ok: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { ok: false, error: auth.error, code: 'AUTH_FAILED' });
  }

  const db = initAdminDb('admin-ai-ops-center');
  if (!db) {
    return json(req, res, 503, { ok: false, error: 'Firestore unavailable', code: 'DB_UNAVAILABLE' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const requestedLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const nowMs = Date.now();

  const reads = [
    ['bookings', recent(db, 'bookings', limit)],
    ['pending_bookings', recent(db, 'pending_bookings', limit)],
    ['mood_bookings', recent(db, 'mood_bookings', limit)],
    ['charter_inquiries', recent(db, 'charter_inquiries', limit)],
    ['pending_free_claims', recent(db, 'pending_free_claims', limit)],
    ['cs_tickets', recent(db, 'cs_tickets', limit)],
    ['payment_reviews', db.collection('payment_reviews').where('resolvedAt', '==', null).limit(limit).get()],
    ['decision_queue', db.collection('decision_queue').where('status', '==', 'pending').limit(limit).get()],
    ['runtime_flags', db.collection('admin_config').doc('runtime_flags').get()],
    ['pending_processor_retries', activeRetries(db, 'pending_processor_retries', limit)],
    ['pending_email_retries', activeRetries(db, 'pending_email_retries', limit)],
    ['pending_ai_planner_retries', activeRetries(db, 'pending_ai_planner_retries', limit)],
  ];

  try {
    const settled = await Promise.allSettled(reads.map((entry) => entry[1]));
    const byKey = {};
    reads.forEach((entry, index) => { byKey[entry[0]] = settled[index]; });
    const failures = [];

    const bookingDocs = resultDocs('bookings', byKey.bookings, failures);
    const pendingDocs = resultDocs('pending_bookings', byKey.pending_bookings, failures);
    const moodDocs = resultDocs('mood_bookings', byKey.mood_bookings, failures);
    const reservationsRaw = [
      ...bookingDocs.map((row) => normalizeReservation('bookings', row.id, row.data, nowMs)),
      ...pendingDocs.map((row) => normalizeReservation('pending_bookings', row.id, row.data, nowMs)),
      ...moodDocs.map((row) => normalizeReservation('mood_bookings', row.id, row.data, nowMs)),
    ];
    const deduped = dedupeConfirmedPendingMirrors(reservationsRaw);
    const reservations = deduped.items.sort(compareReservations);

    const inquiryItems = [
      ...resultDocs('charter_inquiries', byKey.charter_inquiries, failures)
        .map((row) => normalizeInquiry('charter_inquiries', row.id, row.data, nowMs)),
      ...resultDocs('pending_free_claims', byKey.pending_free_claims, failures)
        .map((row) => normalizeInquiry('pending_free_claims', row.id, row.data, nowMs)),
    ];
    const csItems = resultDocs('cs_tickets', byKey.cs_tickets, failures)
      .map((row) => normalizeCsTicket(row.id, row.data, nowMs));
    const inboxItems = [...inquiryItems, ...csItems];

    const paymentReviews = resultDocs('payment_reviews', byKey.payment_reviews, failures)
      .map((row) => normalizePaymentReview(row.id, row.data, nowMs));
    const decisions = resultDocs('decision_queue', byKey.decision_queue, failures)
      .map((row) => normalizeDecision(row.id, row.data, nowMs));

    const processorRetryDocs = retryDocs('pending_processor_retries', byKey.pending_processor_retries, failures);
    const emailRetryDocs = retryDocs('pending_email_retries', byKey.pending_email_retries, failures);
    const plannerRetryDocs = retryDocs('pending_ai_planner_retries', byKey.pending_ai_planner_retries, failures);

    let autoAckEnabled = false;
    let autoAckKnown = false;
    const runtimeResult = byKey.runtime_flags;
    if (runtimeResult.status === 'fulfilled') {
      const runtimeData = runtimeResult.value.exists ? (runtimeResult.value.data() || {}) : {};
      autoAckEnabled = runtimeData.inquiry_auto_ack_enabled === true;
      autoAckKnown = true;
    } else {
      failures.push('runtime_flags');
      console.error('[admin-ai-ops-center] runtime_flags read failed:', runtimeResult.reason && runtimeResult.reason.message);
    }

    const automation = [
      {
        key: 'inquiry_auto_ack',
        label: '문의 자동 접수확인',
        status: autoAckKnown ? (autoAckEnabled ? 'ok' : 'off') : 'unknown',
        pending: 0,
        manual: 0,
        count: 0,
        detail: autoAckKnown ? (autoAckEnabled ? '켜짐 · 최종 답변은 사람 승인' : '꺼짐') : '상태 확인 실패',
        deepLink: '/admin/claims',
      },
      retryQueueHealth(
        'processor_retry',
        '예약 후속처리',
        processorRetryDocs,
        !failures.includes('pending_processor_retries'),
      ),
      retryQueueHealth(
        'email_retry',
        '고객 이메일',
        emailRetryDocs,
        !failures.includes('pending_email_retries'),
      ),
      retryQueueHealth(
        'planner_retry',
        'AI 플래너 생성',
        plannerRetryDocs,
        !failures.includes('pending_ai_planner_retries'),
      ),
      {
        key: 'github_checks',
        label: 'GitHub 정기검사',
        status: 'unlinked',
        pending: 0,
        manual: 0,
        count: 0,
        detail: '실행 이력 미연동 · GitHub에서 확인',
        deepLink: GITHUB_ACTIONS_URL,
      },
    ];

    const aggregate = summarizeOps({
      reservations,
      inboxItems,
      paymentReviews,
      decisions,
      automation,
      sourceFailures: failures,
    }, nowMs);

    const sources = reads.map((entry) => sourceState(entry[0], byKey[entry[0]], limit));
    return json(req, res, 200, {
      ok: true,
      data: {
        generatedAt: new Date(nowMs).toISOString(),
        summary: aggregate.summary,
        workItems: aggregate.workItems.slice(0, 80),
        reservations: reservations.map(publicReservation),
        inboxItems,
        automation,
        sources,
        partialErrors: [...new Set(failures)],
        deduplication: {
          rule: 'confirmed-pending-exact-identifier-only',
          removedMirrorCount: deduped.removed.length,
        },
        window: {
          perSourceLimit: limit,
          note: '최근 자료 기준',
        },
      },
    });
  } catch (error) {
    console.error('[admin-ai-ops-center] aggregate failed:', error && error.message);
    await captureError(error, { route: '/api/admin-ai-ops-center', method: req.method });
    return json(req, res, 500, { ok: false, error: 'Failed to build operations view', code: 'AGGREGATE_FAILED' });
  }
}
