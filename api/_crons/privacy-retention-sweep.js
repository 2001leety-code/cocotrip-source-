/**
 * 개인정보 보관 기간 정기 작업 — GET /api/cron-runner?job=privacy-retention-sweep
 *
 * 🔒 기본은 "개수만 셈". 실제로 지우려면 운영자가 PRIVACY_RETENTION_DELETE_ENABLED='true' 를 따로 켠다.
 * 결과는 개수만 `privacy_retention_state/last` 에 남긴다(이름·이메일·문서 내용 없음).
 *
 * - 예약·결제 문서는 통째로 지우지 않는다: 여행 준비 칸만 "칸 삭제"(FieldValue.delete)로 비운다.
 *   빈 값 덮어쓰기·문서 통째 다시 쓰기 금지(undefined 쓰기 거부, Timestamp 뭉개짐 — src/lib/firestore-safe.ts 참고).
 *   배열 칸(cart_orders.lines)만 다시 쓰며, 그때도 평범한 객체만 복사한다(withoutKeysDeep).
 * - 칸·기간 근거: api/_shared/privacy-retention.js 머리말, 칸별 표(작업 보고서).
 * - 시트 `Leads` 탭은 동향용으로 남기되(운영자 11/21) 1개월 지난 줄의 이메일·이름·일정 번호를 비우고 시각을 달로 줄인다.
 * - 무료 플랜 신청 영수증(Storage `free_claims/`)도 스위치가 켜졌을 때만 지운다. 꺼져 있으면 개수(receiptFilesDue)만.
 */
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import * as R from '../_shared/privacy-retention.js';

const MONTH = Object.freeze({ months: 1 });
const THIRTY_DAYS = Object.freeze({ days: 30 });
const THREE_YEARS = Object.freeze({ years: 3 });
/** 속도 제한·자동 답장 표(운영자 11/22): 창이 1시간(IP)·하루(대화·자동 답장)라 그 뒤엔 쓸 데가 없다. */
const ONE_DAY = Object.freeze({ days: 1 });
const TWO_DAYS = Object.freeze({ days: 2 });
const lower = value => String(value || '').trim().toLowerCase();
const PAGE = 300;
const TIME_BUDGET_MS = 45_000;
/** 켠 뒤에도 하루 이만큼만 바꾼다(문서 하나 또는 예약 하나와 그 사본 묶음 = 1). 남은 것은 다음 날. */
export const DAILY_WRITE_CAP = 200;

export const retentionMode = env => (env.PRIVACY_RETENTION_DELETE_ENABLED === 'true' ? 'delete' : 'count');

function makeRun({ db, nowMs, mode, clock }) {
  const counts = {};
  const run = {
    db, nowMs, mode, clock, counts, writes: 0, timedOut: false, errors: [],
    /** 정산·변경 다툼이 열린 협력사 예약의 날짜 — 그 날 일정 메모도 남긴다. */
    heldMoodDates: new Set(),
    deadline: clock() + TIME_BUDGET_MS,
    /** 지금 대상의 몫(runTargets 가 정함). 한 대상이 시간을 다 써서 뒤 대상이 세지도 못하는 일을 막는다. */
    targetDeadline: clock() + TIME_BUDGET_MS,
    outOfTime: () => clock() > run.targetDeadline,
    /** 시간 몫을 다 써서 멈춤 — 그 대상 개수는 빠진 것이지 0 이 아니다. */
    stop(target) { run.timedOut = true; run.tally(target, 'timedOut'); },
    tally(target, key, n = 1) { const c = (counts[target] ||= {}); c[key] = (c[key] || 0) + n; },
    /** 지울 것 하나를 센다. 실제로 써도 되면 true(삭제 모드 + 하루 상한·시간 안). */
    claim(target) {
      run.tally(target, 'due');
      if (mode !== 'delete') return false;
      if (run.writes >= DAILY_WRITE_CAP || run.outOfTime()) { run.tally(target, 'deferred'); return false; }
      run.writes += 1;
      return true;
    },
  };
  return run;
}

/** 문서(시트 줄) 하나의 오류 — 그 대상의 나머지는 계속 본다. 오류 글은 손님 값이 섞일 수 있어 코드만 남긴다. */
function docFailed(run, target, error) {
  run.tally(target, 'docError');
  if (!run.errors.includes(target)) run.errors.push(target);
  console.warn('[privacy-retention] doc failed:', target, error?.code || error?.name || 'error');
}

// 쿼리 범위: Timestamp 칸은 Date, ms 숫자 칸은 숫자, 'YYYY-MM-DD' 칸은 문자열로 비교해야 한다(타입이 다르면 0건).
const cutoffMs = (run, period) => R.scanCutoffMs(run.nowMs, period);
const cutoffDate = (run, period) => new Date(cutoffMs(run, period));
const cutoffYmd = (run, period) => R.kstYmd(cutoffMs(run, period));
const marker = run => ({ version: R.RETENTION_VERSION, scrubbedAtMs: run.nowMs });

async function scrubPaths(run, target, ref, paths) {
  const args = paths.flatMap(path => [new FieldPath(...path), FieldValue.delete()]);
  await ref.update(...args, 'privacyRetention', marker(run));
  run.tally(target, 'applied');
}

/**
 * 범위 쿼리를 끝까지 넘겨 본다. 문서 하나가 오류를 내도 그 문서만 건너뛴다(docError).
 * ponytail: 매일 전체 훑기 — 지난 문서가 수만 건이 되면 커서 저장으로 바꿀 것.
 */
async function scan(run, target, query, orderField, onDoc) {
  let last = null;
  for (;;) {
    if (run.outOfTime()) return run.stop(target);
    let q = query.orderBy(orderField).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const doc of snap.docs) {
      if (run.outOfTime()) return run.stop(target);
      try { await onDoc(doc, doc.data() || {}); } catch (error) { docFailed(run, target, error); }
    }
    if (snap.docs.length < PAGE) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

const topLevelPaths = (data, keys) => keys.filter(key => data && data[key] !== undefined).map(key => [key]);
const alreadyMarked = d => Number(d?.privacyRetention?.version) >= R.RETENTION_VERSION;

async function snapshotEnd(db, orderId) {
  if (!orderId) return null;
  const snap = await db.collection('paypal_order_snapshots').doc(String(orderId)).get();
  return snap.exists ? (snap.data() || {}).dateEnd || null : null;
}

// ── 예약 (결제·계약 칸 남김) ─────────────────────────────────────────────────
/** 예약 끝날. 결제 스냅샷은 tourEndDate 가 없을 때만 읽는다(읽기 줄이기). */
async function bookingEndYmd(run, id, d) {
  const snapshot = R.validYmd(d.tourEndDate) ? null : await snapshotEnd(run.db, d.orderID || String(id).split('__')[0]);
  return R.tripEndYmd(d.tourDate, [d.tourEndDate, snapshot]);
}

async function sweepBookings(run) {
  const T = 'bookings';
  await scan(run, T, run.db.collection(T).where('tourDate', '<=', cutoffYmd(run, MONTH)), 'tourDate', async (doc, d) => {
    const paths = topLevelPaths(d, R.BOOKING_TRIP_KEYS);
    if (!paths.length && alreadyMarked(d)) return run.tally(T, 'alreadyClean');
    // 싼 판정 먼저(상태·날짜), 읽기(스냅샷·배차 기록)는 그 뒤 — 쌓인 예약이 많아도 시간 예산 안에 들게.
    if (!R.bookingSettled(d.status)) return run.tally(T, 'heldStatus');
    const end = await bookingEndYmd(run, doc.id, d);
    if (!end) return run.tally(T, 'noDate');
    if (!R.isDue(end, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    const dispatches = (await run.db.collection('dispatch_messages').where('orderID', '==', doc.id).get()).docs;
    if (!paths.length && !dispatches.length) return run.tally(T, 'alreadyClean');
    if (!run.claim(T)) return;
    // 배차 기록 먼저 — 예약에 표시(privacyRetention)가 붙은 뒤엔 배차 기록을 다시 찾지 않는다.
    for (const dispatch of dispatches) { await dispatch.ref.delete(); run.tally('dispatch_messages', 'applied'); }
    await scrubPaths(run, T, doc.ref, paths);
  });
}

async function sweepPendingBookings(run) {
  const T = 'pending_bookings';
  await scan(run, T, run.db.collection(T).where('dateStart', '<=', cutoffYmd(run, MONTH)), 'dateStart', async (doc, d) => {
    const paths = topLevelPaths(d, R.BOOKING_TRIP_KEYS);
    if (!paths.length) return run.tally(T, 'alreadyClean');
    if (!R.bookingSettled(d.status)) return run.tally(T, 'heldStatus');
    const end = R.tripEndYmd(d.dateStart, [d.dateEnd]);
    if (!end) return run.tally(T, 'noDate');
    if (!R.isDue(end, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    if (run.claim(T)) await scrubPaths(run, T, doc.ref, paths);
  });
}

/**
 * 결제 기록 안 사본 — 문서는 남긴다(used_paypal_orders 는 이중 결제 잠금). 문서 번호 = PayPal 주문 번호.
 * hold(data, id) = 건너뛸 이유 또는 null. 끝날 = 사본 날짜와 예약 문서의 지금 날짜 중 늦은 날
 * (손님이 날짜를 뒤로 옮기면 modifyBooking.js 는 예약 문서만 바꾸고 사본은 옛 날짜로 둔다).
 */
async function sweepPaymentCopy(run, T, query, orderField, under, hold) {
  await scan(run, T, query, orderField, async (doc, d) => {
    const paths = R.findKeyPaths(d, R.PAYMENT_COPY_TRIP_KEYS, { under, maxDepth: 1 });
    if (!paths.length) return run.tally(T, 'alreadyClean');
    const reason = await hold(d, doc.id);
    if (reason) return run.tally(T, reason);
    const body = under.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), d) || {};
    const booking = await findBookingByOrderId(run, doc.id);
    // 환불·취소 진행 중인 예약은 예약 문서도 남기므로 그 결제 사본도 남긴다.
    if (booking && !R.bookingSettled(booking.data.status)) return run.tally(T, 'heldBookingStatus');
    const end = R.tripEndYmd(null, [R.tripEndYmd(body.tourDate, [await snapshotEnd(run.db, doc.id)]),
      booking ? await bookingEndYmd(run, booking.id, booking.data) : null]);
    if (!end) return run.tally(T, 'noDate');
    if (!R.isDue(end, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    if (run.claim(T)) await scrubPaths(run, T, doc.ref, paths);
  });
}

/**
 * 결제 전(created) 장바구니 = 만든 날 + 1개월에 문서 삭제(운영자 11/22). 결제 시도 기록(used_paypal_orders, 같은 번호)이
 * 없거나 돈을 안 가져간 것이 확실할 때만. 돈을 가져갔을 수 있으면 결제 복구가 이 문서를 읽으므로 남긴다.
 */
async function sweepUnpaidCart(run, doc, d) {
  const T = 'cart_orders_unpaid';
  const base = R.msToKstYmd(d.createdAt);
  if (!base) return run.tally(T, 'noDate');
  if (!R.isDue(base, MONTH, run.nowMs)) return run.tally(T, 'notYet');
  const lock = await run.db.collection('used_paypal_orders').doc(doc.id).get();
  if (lock.exists && !R.attemptTookNoMoney(lock.data() || {})) return run.tally(T, 'heldPaymentAttempt');
  if (!run.claim(T)) return;
  await doc.ref.delete();
  run.tally(T, 'applied');
}

async function sweepCartOrders(run) {
  const T = 'cart_orders';
  await scan(run, T, run.db.collection(T).where('createdAt', '<=', cutoffDate(run, MONTH)), 'createdAt', async (doc, d) => {
    if (lower(d.status) === 'created') return sweepUnpaidCart(run, doc, d);
    const lines = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.some(line => topLevelPaths(line?.booking, R.PAYMENT_COPY_TRIP_KEYS).length)) return run.tally(T, 'alreadyClean');
    // 결제 끝난 것만(칸표). payment_review 등은 남기고 개수만 센다.
    if (!R.cartPaid(d.status)) return run.tally(T, 'heldStatus');
    const ends = lines.map(line => R.tripEndYmd(line?.booking?.dateStart, [line?.booking?.dateEnd]));
    if (ends.some(end => !end)) return run.tally(T, 'noDate');
    if (!R.isDue([...ends].sort().pop(), MONTH, run.nowMs)) return run.tally(T, 'notYet');
    if (!run.claim(T)) return;
    const cleaned = lines.map(line => (line && line.booking
      ? { ...line, booking: R.withoutKeysDeep(line.booking, R.PAYMENT_COPY_TRIP_KEYS) } : line));
    await doc.ref.update('lines', cleaned, 'privacyRetention', marker(run));
    run.tally(T, 'applied');
  });
}

// ── 협력사 포털 (운행일 = 끝날, 하루짜리) ────────────────────────────────────
/** 협력사 예약 꼴의 여행 준비 칸: 맨 위 칸 + breakdown 안 출발·도착·경유지. */
function moodPaths(d) {
  return [...topLevelPaths(d, R.MOOD_TRIP_KEYS),
    ...R.findKeyPaths(d, ['origin', 'destination', 'waypoints'], { under: ['breakdown'], maxDepth: 1 })];
}
/** 변경 이력·견적: 자기 칸 + 예약 통째 사본(before·after·requestSnapshot) 안의 같은 칸. */
function moodCopyPaths(d) {
  const out = moodPaths(d);
  for (const root of ['before', 'after', 'requestSnapshot']) {
    if (d[root] && typeof d[root] === 'object') out.push(...moodPaths(d[root]).map(path => [root, ...path]));
  }
  return out;
}

async function sweepMoodBookings(run) {
  const T = 'mood_bookings';
  await scan(run, T, run.db.collection(T).where('date', '<=', cutoffYmd(run, MONTH)), 'date', async (doc, d) => {
    const paths = moodPaths(d);
    if (!paths.length && alreadyMarked(d)) return run.tally(T, 'alreadyClean');
    if (!R.moodBookingSettled(d)) { if (R.validYmd(d.date)) run.heldMoodDates.add(d.date); return run.tally(T, 'heldStatus'); }
    if (!R.validYmd(d.date)) return run.tally(T, 'noDate');
    if (!R.isDue(d.date, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    const copies = [];
    for (const name of ['mood_booking_change_events', 'mood_booking_change_quotes']) {
      for (const copy of (await run.db.collection(name).where('bookingId', '==', doc.id).get()).docs) {
        const copyPaths = moodCopyPaths(copy.data() || {});
        if (copyPaths.length) copies.push({ name, ref: copy.ref, paths: copyPaths });
      }
    }
    if (!paths.length && !copies.length) return run.tally(T, 'alreadyClean');
    if (!run.claim(T)) return;
    for (const copy of copies) await scrubPaths(run, copy.name, copy.ref, copy.paths);
    await scrubPaths(run, T, doc.ref, paths);
  });
}

/**
 * 협력사 예약 변경 중복 막기 기록 = 끝난 뒤 + 1개월에 요청자 이메일·응답 사본만 비우고 문서는 남긴다(운영자 11/22).
 * 문서가 남아 있으면 늦게 다시 온 같은 요청은 다시 처리되지 않고 409(IDEMPOTENCY_RESPONSE_MISSING)를 받는다(mood-change.js).
 */
async function sweepMoodIdempotency(run) {
  const T = 'mood_booking_change_idempotency';
  await scan(run, T, run.db.collection(T).where('completedAt', '<=', cutoffMs(run, MONTH)), 'completedAt', async (doc, d) => {
    const paths = topLevelPaths(d, ['actorEmail', 'response']);
    if (!paths.length) return run.tally(T, 'alreadyClean');
    if (lower(d.status) !== 'completed') return run.tally(T, 'heldStatus');
    const base = R.msToKstYmd(d.completedAt);
    if (!base) return run.tally(T, 'noDate');
    if (!R.isDue(base, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    if (run.claim(T)) await scrubPaths(run, T, doc.ref, paths);
  });
}

/**
 * "이미 예약했어요 → 무료 플랜" 신청 = 승인·거절된 날 + 1개월에 문서와 그 문서가 가리키는 영수증 파일 삭제(운영자 11/22).
 * 처리 전(pending)은 세기만. 영수증 하나라도 우리 버킷 `free_claims/` 파일로 못 읽으면 신청째 남긴다(파일을 놓치지 않게).
 * 파일 먼저 지우고 문서는 마지막 — 중간에 실패하면 다음 날 문서로 다시 찾는다(없는 파일은 넘어감).
 * ponytail: 작은 컬렉션이라 세 상태를 매일 다 읽는다 — 커지면 reviewedAt 범위 쿼리로.
 */
async function sweepFreeClaims(run, storage, buckets) {
  const T = 'pending_free_claims';
  const query = run.db.collection(T).where('status', 'in', ['pending', 'approved', 'rejected']);
  await scan(run, T, query, FieldPath.documentId(), async (doc, d) => {
    if (d.status === 'pending') {
      const created = R.msToKstYmd(d.createdAt);
      return run.tally(T, created && !R.isDue(created, MONTH, run.nowMs) ? 'notYet' : 'heldPending');
    }
    const base = R.msToKstYmd(d.reviewedAt);
    if (!base) return run.tally(T, 'noDate');
    if (!R.isDue(base, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    const files = (Array.isArray(d.receipts) ? d.receipts : []).map(receipt => R.freeClaimReceiptObject(receipt?.url, buckets));
    if (files.some(file => !file)) return run.tally(T, 'heldReceiptUnknown');
    if (files.length) run.tally(T, 'receiptFilesDue', files.length);
    if (!run.claim(T)) return;
    for (const file of files) { await storage.deleteFile(file.bucket, file.path); run.tally(T, 'receiptFilesDeleted'); }
    await doc.ref.delete();
    run.tally(T, 'applied');
  });
}

// ── 문서 통째로 지우는 곳 ───────────────────────────────────────────────────
/**
 * baseOf(data) = 기준 시각, 또는 baseYmd(data, id) = 기준 한국 날짜. hold(data, id) = 건너뛸 이유 또는 null.
 * holdWhenDue(data, id) = 때가 된 문서만 한 번 더 보는 (비싼) 확인, 건너뛸 이유 또는 null. countOnly = 세기만.
 */
async function sweepWholeDocs(run, T, { query, orderField, period, baseOf, baseYmd = null, hold = () => null, holdWhenDue = null, countOnly = false, before = null }) {
  await scan(run, T, query, orderField, async (doc, d) => {
    const reason = hold(d, doc.id);
    if (reason) return run.tally(T, reason);
    const base = baseYmd ? baseYmd(d, doc.id) : R.msToKstYmd(baseOf(d, doc.id));
    if (!base) return run.tally(T, 'noDate');
    if (!R.isDue(base, period, run.nowMs)) return run.tally(T, 'notYet');
    const dueReason = holdWhenDue ? await holdWhenDue(d, doc.id) : null;
    if (dueReason) return run.tally(T, dueReason);
    if (countOnly) return run.tally(T, 'dueCountOnly');
    if (!run.claim(T)) return;
    if (before) await before(doc);
    await doc.ref.delete();
    run.tally(T, 'applied');
  });
}

async function deleteChatChildren(run, sessionDoc) {
  // ponytail: 하나씩 지움 — 한 대화 메시지가 수백 개를 넘으면 batch 로 바꿀 것.
  const messages = await sessionDoc.ref.collection('messages').get();
  for (const message of messages.docs) await message.ref.delete();
  const relays = await run.db.collection('inquiry_messages').where('sessionId', '==', sessionDoc.id).get();
  for (const relay of relays.docs) await relay.ref.delete();
  run.tally('chat_sessions', 'childrenDeleted', messages.size + relays.size);
}

/** 처리 안 끝난 일정 신고가 걸린 일정 번호 — 분쟁 증거라 남긴다. */
async function openComplaintPlanIds(run) {
  const ids = new Set();
  for (const status of ['open', 'reviewed']) {
    for (const doc of (await run.db.collection('plan_complaints').where('status', '==', status).get()).docs) {
      const planId = (doc.data() || {}).planId;
      if (planId) ids.add(String(planId));
    }
  }
  return ids;
}

/** ctx.complainedPlanIds 는 앞 대상(plan_complaints_open)이 채운다 — 훑을 때 읽는다. */
function wholeDocTargets(run, ctx) {
  const where = (name, field, value) => run.db.collection(name).where(field, '<=', value);
  const target = (name, field, value, period, options) => [name, { query: where(name, field, value), orderField: field, period, ...options }];
  return [
    target('preview_leads', 'lastSeenAtMs', cutoffMs(run, MONTH), MONTH, { baseOf: d => d.lastSeenAtMs }),
    // 처리 끝 시각: 답장·종료는 updatedAtMs(숫자)에, 만들 때는 updatedAt(Timestamp)에 남는다 → 가장 늦은 것. 범위는 만든 날.
    target('charter_inquiries', 'createdAt', cutoffDate(run, THIRTY_DAYS), THIRTY_DAYS, {
      baseOf: d => R.latestMs(d.updatedAtMs, d.updatedAt, d.createdAt), hold: d => (R.inquiryClosed(d.status) ? null : 'heldOpen') }),
    target('chat_sessions', 'lastMessageAt', cutoffDate(run, MONTH), MONTH, {
      baseOf: d => d.lastMessageAt, before: doc => deleteChatChildren(run, doc) }),
    // 재시도 대기열: 끝난(done) 것만. 정상 경로는 sweptAt 없이 completedAt·updatedAt 만 남긴다 → 가장 늦은 시각.
    // 사람이 봐야 하는 것(manual-intervention 등)은 done 이 아니라 아예 안 잡힌다.
    ...['pending_email_retries', 'pending_processor_retries', 'pending_ai_planner_retries'].map(name => [name, {
      query: run.db.collection(name).where('status', '==', 'done'), orderField: FieldPath.documentId(), period: MONTH,
      baseOf: d => R.latestMs(d.sweptAt, d.completedAt, d.updatedAt, d.closedAt, d.lastFailureAt) }]),
    target('quick_book_pending', 'createdAt', cutoffDate(run, MONTH), MONTH, { baseOf: d => d.createdAt }),
    // 문서 번호 = 'YYYY-MM-DD'(그 날 메모). month 칸으로 범위를 좁힌다. 협력사 예약 훑기가 실패했으면 다툼을 모르니 다 남긴다.
    target('mood_schedule_notes', 'month', cutoffYmd(run, MONTH).slice(0, 7), MONTH, {
      baseYmd: (d, id) => (R.validYmd(id) ? id : null),
      hold: (d, id) => (run.errors.includes('mood_bookings') ? 'heldMoodUnknown' : run.heldMoodDates.has(id) ? 'heldDispute' : null) }),
    // 불만·분쟁 3년: 처리를 마친(resolved) 것만 지운다. 처리 중인 것은 마칠 때까지 남긴다(운영자 11/22).
    ...['cs_tickets', 'plan_complaints'].map(name => target(name, 'createdAt', cutoffDate(run, THREE_YEARS), THREE_YEARS, {
      baseOf: d => d.createdAt, hold: d => (R.disputeClosed(d.status) ? null : 'heldOpen') })),
    // 운영자 11/21: 분쟁 증거로 보존한 문의 3년은 이번엔 세기만.
    target('external_inbox_cases', 'updatedAtMs', cutoffMs(run, THREE_YEARS), THREE_YEARS, {
      baseOf: d => d.updatedAtMs, countOnly: true, hold: d => (d.status === 'protected' ? null : 'notProtected') }),
    // 비회원 AI 일정 = 여행 끝 + 1개월에 문서 삭제(운영자 11/21). 회원 일정은 탈퇴 때까지.
    // 만든 날 <= 여행 끝이라 만든 날로 범위를 좁힌다.
    ['plans_guest', {
      query: where('plans', 'createdAtMs', cutoffMs(run, MONTH))
        .select('uid', 'createdAtMs', 'paymentSource', 'isFreeCoupon', 'isAdminBypass', 'input.startDate', 'input.durationDays'),
      orderField: 'createdAtMs', period: MONTH, baseYmd: d => R.planTripEndYmd(d.input),
      // 돈을 낸(또는 모르는) 일정 = 결제 분쟁 증거 → 만든 날 + 180일까지 남기고, 그 뒤엔 여행 끝 + 1개월 규칙(= 늦은 날).
      // 만든 날을 모르면 계속 남긴다.
      hold: (d, id) => (d.uid !== null ? 'member' : ctx.complainedPlanIds.has(id) ? 'heldComplaint'
        : R.paidPlan(d) && !R.isDue(R.msToKstYmd(d.createdAtMs), R.PAID_PLAN_MIN, run.nowMs) ? 'heldPaid' : null) }],
    // 입금 확인을 기다리는 수동 결제 신청 = 신청 + 1개월에 문서 삭제(운영자 11/21). 확인된 신청은 위 예약 규칙(결제 칸 5년).
    // 이 신청은 "손님이 송금했다"는 신고다. PayPal 이 이 예약 번호로 돈을 보냈다는 기록(금액 불일치·확정 실패 등으로
    // 자동 확정이 안 된 것)이 있으면 돈 기록이라 남긴다(paypal-webhook.js 가 detail.bookingRef 로 남김).
    ['pending_bookings_unverified', {
      query: run.db.collection('pending_bookings').where('status', '==', 'AWAITING_VERIFICATION'),
      orderField: FieldPath.documentId(), period: MONTH, baseOf: d => d.createdAt,
      holdWhenDue: async (d, id) => ((await run.db.collection('paypal_webhook_log').where('detail.bookingRef', '==', id).limit(1).get()).empty
        ? null : 'heldPaymentSeen') }],
    // 운영자 11/22: 손님 말(raw_text)·이메일이 든 분류기 기록 = 만든 날 + 1개월. ts 는 ISO 글자라 ISO 글자로 비교한다.
    target('intent_classifier_logs', 'ts', new Date(cutoffMs(run, MONTH)).toISOString(), MONTH, { baseOf: d => d.ts }),
    // 알림 본문에 예약 번호·이메일이 섞일 수 있는 오류 기록 = 1개월(읽는 곳은 길어야 주간 보고).
    target('error_log', 'createdAt', cutoffMs(run, MONTH), MONTH, { baseOf: d => d.createdAt }),
  ];
}

/**
 * 문서 번호에 사람 식별값(uid·IP 해시·이메일 해시·게스트 세션)이 든 속도 제한·중복 막기 표. 개인정보 대상보다 뒤에 돌려
 * 하루 상한을 먼저 쓰지 않게 한다. 대화 표는 문서 꼴에 따라 시각 칸 이름이 둘(updatedAt / lastUpdated)이라 두 번 훑는다.
 */
function lowPriorityTargets(run) {
  const target = (name, collection, field, period) => [name, {
    query: run.db.collection(collection).where(field, '<=', cutoffMs(run, period)), orderField: field, period, baseOf: d => d[field] }];
  return [
    target('chat_rate_limits', 'chat_rate_limits', 'updatedAt', TWO_DAYS),
    target('chat_rate_limits_daily', 'chat_rate_limits', 'lastUpdated', TWO_DAYS),
    // 문서 번호 = IP·회원 해시, 창 1시간(checkIpRateLimit 기본값, 늘린 곳 없음) 또는 1분(대화 새로고침) → 1일.
    ...IP_RATE_LIMIT_COLLECTIONS.map(name => target(name, name, 'lastSeenAtMs', ONE_DAY)),
    target('inquiry_auto_ack_recipients', 'inquiry_auto_ack_recipients', 'reservedAtMs', TWO_DAYS),
  ];
}

/**
 * 처리방침 "속도 제한 기록 1~2일"의 대상 전부 — `checkIpRateLimit(..., collection: …)` 를 부르는 곳과
 * 같은 꼴(count·windowStartedAtMs·lastSeenAtMs)을 쓰는 대화 새로고침 제한(chat-session-auth.js).
 * 새 곳을 만들면 여기에 넣는다(시험이 api/ 의 호출 목록과 대조한다).
 */
export const IP_RATE_LIMIT_COLLECTIONS = Object.freeze([
  'preview_lead_rate_limits', 'inquiry_rate_limits', 'quick_plan_rate_limits', 'pdf_cutoff_alert_rate_limits',
  'calc_distance_rate_limits', 'community_rate_limits', 'course_ai_rate_limits', 'course_route_rate_limits',
  'course_share_rate_limits', 'manual_payment_rate_limits', 'claim_notify_rate_limits', 'place_search_rate_limits',
  'recalc_transit_rate_limits', 'complaint_rate_limits', 'translate_plan_rate_limits', 'chat_poll_rate_limits',
]);

// ── 구글 시트 예약 장부 `시트1` (운영에서만) ──────────────────────────────────
/** 장부 N열(PayPal 주문 번호)로 예약 문서 찾기. 문서 번호가 주문 번호이거나, orderID 칸이 주문 번호. */
async function findBookingByOrderId(run, orderId) {
  if (!orderId) return null;
  // 손 입력 칸에 '/' 가 들면 문서 경로가 되어 오류가 난다 → 번호 칸으로만 찾는다.
  const direct = orderId.includes('/') ? null : await run.db.collection('bookings').doc(orderId).get();
  if (direct?.exists) return { id: orderId, data: direct.data() || {} };
  const byField = (await run.db.collection('bookings').where('orderID', '==', orderId).limit(1).get()).docs[0];
  return byField ? { id: byField.id, data: byField.data() || {} } : null;
}

async function sweepBookingSheet(run, sheets) {
  const T = 'sheet_bookings';
  let rows;
  try { rows = await sheets.readRetentionSheetRows('bookings'); } catch (error) {
    if (error?.skipped) return run.tally(T, 'skipped');
    throw error;
  }
  const columns = Object.entries(sheets.BOOKING_SHEET_TRIP_COLUMNS);
  const cells = [];
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue; // 머리 줄
    if (run.outOfTime()) { run.stop(T); break; }
    try {
      const filled = columns.filter(([, i]) => R.cellText(row?.[i]) !== '');
      if (!filled.length) { run.tally(T, 'alreadyClean'); continue; }
      // ponytail: 장부엔 끝날이 없다 → 투어날짜 + 14일을 끝날로 봄(예약 문서보다 늦게 지워짐, 일찍은 안 지움).
      const end = R.tripEndYmd(R.sheetDateYmd(row?.[5]), []);
      if (!end) { run.tally(T, 'noDate'); continue; }
      if (!R.isDue(end, MONTH, run.nowMs)) { run.tally(T, 'notYet'); continue; }
      // 손님이 날짜를 바꾸면 예약 문서만 바뀌고 장부는 손으로 고친다(modifyBooking.js) → 장부 날짜는 옛 날짜일 수 있다.
      const booking = await findBookingByOrderId(run, R.cellText(row?.[13]));
      if (booking) {
        // 환불·취소 진행 중인 예약은 예약 문서도 남기므로(heldStatus) 장부 줄도 남긴다 — R열 손 메모는 장부에만 있다.
        if (!R.bookingSettled(booking.data.status)) { run.tally(T, 'heldStatus'); continue; }
        const bookingEnd = await bookingEndYmd(run, booking.id, booking.data);
        if (!bookingEnd || !R.isDue(bookingEnd, MONTH, run.nowMs)) { run.tally(T, 'heldBookingNotDue'); continue; }
      }
      if (run.claim(T)) for (const [column] of filled) cells.push({ row: index + 1, column, value: '' });
    } catch (error) { docFailed(run, T, error); }
  }
  await writeUnchangedRows(run, T, sheets, 'bookings', rows, cells);
}

/**
 * 읽은 뒤 쓰기 전에 누가 줄을 정렬·삭제하면 같은 줄 번호가 다른 사람을 가리킨다 →
 * 쓰기 직전 탭을 다시 읽어 한 칸이라도 바뀐 줄은 오늘 건너뛴다(heldRowChanged, 내일 다시 봄).
 * ponytail: 다시 읽기와 쓰기 사이(요청 하나) 틈은 남는다 — 시트 API 에 조건부 쓰기가 없다.
 */
async function writeUnchangedRows(run, T, sheets, tab, rows, cells) {
  if (!cells.length) return;
  const fresh = await sheets.readRetentionSheetRows(tab);
  const same = rowNumber => JSON.stringify(rows[rowNumber - 1]) === JSON.stringify(fresh[rowNumber - 1]);
  const changed = new Set(cells.filter(c => !same(c.row)).map(c => c.row));
  if (changed.size) run.tally(T, 'heldRowChanged', changed.size);
  const safe = cells.filter(c => !changed.has(c.row));
  if (!safe.length) return;
  await sheets.writeRetentionSheetCells(tab, safe);
  run.tally(T, 'applied', new Set(safe.map(c => c.row)).size);
}

// ── 구글 시트 `Leads` 탭 — 줄은 동향용으로 남기고 사람을 알아보는 칸만 비움 ─────────────
async function sweepLeadsSheet(run, sheets) {
  const T = 'sheet_leads';
  let rows;
  try { rows = await sheets.readRetentionSheetRows('leads'); } catch (error) {
    if (error?.skipped) return run.tally(T, 'skipped');
    throw error;
  }
  const identifying = Object.entries(sheets.LEADS_IDENTIFYING_COLUMNS);
  const cells = [];
  rows.forEach((row, index) => {
    const stamp = typeof row?.[0] === 'string' ? row[0].trim() : row?.[0];
    const monthOnly = typeof stamp === 'string' && R.MONTH_ONLY.test(stamp);
    // A 가 이미 달(YYYY-MM)이면 그 달 말일을 기준일로 본다(늦게 지우는 쪽).
    const base = monthOnly ? R.monthEndYmd(stamp) : R.sheetDateYmd(stamp);
    if (index === 0 && !base) return; // 머리 줄
    const filled = identifying.filter(([, i]) => R.cellText(row?.[i]) !== '');
    if (!filled.length && monthOnly) return run.tally(T, 'alreadyClean');
    if (!base) return run.tally(T, 'noDate');
    if (!R.isDue(base, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    if (!run.claim(T)) return;
    const rowNumber = index + 1;
    if (!monthOnly) cells.push({ row: rowNumber, column: 'A', value: base.slice(0, 7) });
    for (const [column] of filled) cells.push({ row: rowNumber, column, value: '' });
  });
  await writeUnchangedRows(run, T, sheets, 'leads', rows, cells);
}

async function guarded(run, target, fn) {
  try { await fn(); } catch (error) {
    run.errors.push(target); run.tally(target, 'error');
    // 오류 글은 손님 값이 섞일 수 있어 남기지 않는다 — 이름·코드만.
    console.warn('[privacy-retention] target failed:', target, error?.code || error?.name || 'error');
  }
}

/**
 * 대상마다 남은 시간을 남은 대상 수로 나눈 몫만 준다. 일찍 끝난 대상의 남은 몫은 뒤 대상에게 간다.
 * ponytail: 같은 몫 — 앞쪽 큰 대상(예약)이 몫에 걸리면 그날 개수가 덜 나온다(timedOut). 커지면 대상별 커서 저장으로.
 */
async function runTargets(run, jobs) {
  for (const [index, [target, fn]] of jobs.entries()) {
    const now = run.clock();
    run.targetDeadline = Math.min(run.deadline, now + Math.max(0, run.deadline - now) / (jobs.length - index));
    await guarded(run, target, fn);
  }
}

/** 영수증을 지워도 되는 우리 버킷. 미리보기는 그 DB 프로젝트 버킷만(운영 버킷 이름을 넣지 않는다). 하나도 모르면 빈 목록 = 다 남김. */
function receiptBuckets(env, database) {
  let projectId = '';
  try { projectId = String(database.projectId || '').trim(); } catch { /* 첫 요청 전엔 모를 수 있다 */ }
  if (!projectId) projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const buckets = new Set(projectId ? [`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`] : []);
  const explicit = String(env.FIREBASE_STORAGE_BUCKET || '').trim();
  if (explicit && env.VERCEL_ENV !== 'preview') buckets.add(explicit);
  return buckets;
}

function adminStorage(env) {
  return {
    async deleteFile(bucket, path) {
      const [{ getStorage }, { getApps }, admin] = await Promise.all([
        import('firebase-admin/storage'), import('firebase-admin/app'), import('../_shared/firebase-admin.js')]);
      const app = env.VERCEL_ENV === 'preview' ? admin.initAdminApp() : getApps()[0];
      if (!app) throw Object.assign(new Error('storage unavailable'), { code: 'STORAGE_UNAVAILABLE' });
      await getStorage(app).bucket(bucket).file(path).delete({ ignoreNotFound: true });
    },
  };
}

export async function privacyRetentionSweepTask({ env = process.env, now = Date.now, clock = Date.now, db = null, sheets = null, storage = null } = {}) {
  try {
    const nowMs = now();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return { ok: false, code: 'RETENTION_CLOCK_INVALID' };
    const mode = retentionMode(env);
    const database = db || (await import('../_shared/firebase-admin.js')).initAdminDb('privacy-retention');
    if (!database) return { ok: false, code: 'RETENTION_DB_UNAVAILABLE' };
    const run = makeRun({ db: database, nowMs, mode, clock });
    const ctx = { complainedPlanIds: null };
    const loadSheets = async () => sheets || import('../_google-sheets.js');
    const usedOrderHold = async (d, id) => {
      const review = d.reviewQuarantined === true ? await database.collection('payment_reviews').doc(id).get() : null;
      if (R.paymentAttemptClosed(d, review?.exists ? review.data() : null)) return null;
      return d.reviewQuarantined === true ? 'heldQuarantined' : 'heldUnfinished';
    };

    await runTargets(run, [
      ['bookings', () => sweepBookings(run)],
      ['pending_bookings', () => sweepPendingBookings(run)],
      ['used_paypal_orders', () => sweepPaymentCopy(run, 'used_paypal_orders',
        database.collection('used_paypal_orders').where('createdAtMs', '<=', cutoffMs(run, MONTH)), 'createdAtMs', ['intent', 'body'],
        usedOrderHold)],
      ['payment_reviews', () => sweepPaymentCopy(run, 'payment_reviews',
        database.collection('payment_reviews').where('createdAt', '<=', cutoffDate(run, MONTH)), 'createdAt', ['bookingPayload'],
        d => (d.resolvedAt === null || d.resolvedAt === undefined ? 'heldUnresolved' : null))],
      ['cart_orders', () => sweepCartOrders(run)],
      ['mood_bookings', () => sweepMoodBookings(run)],
      ['mood_booking_change_idempotency', () => sweepMoodIdempotency(run)],
      ['pending_free_claims', () => sweepFreeClaims(run, storage || adminStorage(env), receiptBuckets(env, database))],
      ['plan_complaints_open', async () => { ctx.complainedPlanIds = await openComplaintPlanIds(run); }],
      ...wholeDocTargets(run, ctx).map(([target, options]) => [target, async () => {
        // 신고 목록을 못 읽었으면 비회원 일정은 건너뛴다(신고 걸린 일정을 지울 수 있어서).
        if (target === 'plans_guest' && !ctx.complainedPlanIds) return run.tally(target, 'heldComplaintUnknown');
        await sweepWholeDocs(run, target, options);
      }]),
      // 시트는 운영 장부 하나뿐 — 미리보기·개발에서는 읽지도 않는다.
      ...(env.VERCEL_ENV === 'production' ? [
        ['sheet_bookings', async () => sweepBookingSheet(run, await loadSheets())],
        ['sheet_leads', async () => sweepLeadsSheet(run, await loadSheets())],
      ] : []),
      ...lowPriorityTargets(run).map(([target, options]) => [target, () => sweepWholeDocs(run, target, options)]),
    ]);

    const ok = run.errors.length === 0;
    const result = {
      ok, code: ok ? (run.timedOut ? 'RETENTION_PARTIAL' : 'RETENTION_COMPLETED') : 'RETENTION_REVIEW_REQUIRED',
      mode, version: R.RETENTION_VERSION, writes: run.writes, timedOut: run.timedOut, counts: run.counts,
    };
    await database.collection('privacy_retention_state').doc('last').set({ ...result, checkedAtMs: now() });
    return result;
  } catch { return { ok: false, code: 'RETENTION_UNAVAILABLE' }; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { verifyCronRequest } = await import('../_shared/cron-auth.js');
  const authorized = await verifyCronRequest(req);
  if (!authorized.ok) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED' });
  const result = await privacyRetentionSweepTask();
  return res.status(result.ok ? 200 : 503).json(result);
}
