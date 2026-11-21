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
 */
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import * as R from '../_shared/privacy-retention.js';

const MONTH = Object.freeze({ months: 1 });
const THIRTY_DAYS = Object.freeze({ days: 30 });
const THREE_YEARS = Object.freeze({ years: 3 });
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
    tally(target, key, n = 1) { const c = (counts[target] ||= {}); c[key] = (c[key] || 0) + n; },
    /** 지울 것 하나를 센다. 실제로 써도 되면 true(삭제 모드 + 하루 상한·시간 안). */
    claim(target) {
      run.tally(target, 'due');
      if (mode !== 'delete') return false;
      if (run.writes >= DAILY_WRITE_CAP || clock() > run.deadline) { run.tally(target, 'deferred'); return false; }
      run.writes += 1;
      return true;
    },
  };
  return run;
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

/** 범위 쿼리를 끝까지 넘겨 본다. ponytail: 매일 전체 훑기 — 지난 문서가 수만 건이 되면 커서 저장으로 바꿀 것. */
async function scan(run, query, orderField, onDoc) {
  let last = null;
  for (;;) {
    if (run.clock() > run.deadline) { run.timedOut = true; return; }
    let q = query.orderBy(orderField).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const doc of snap.docs) {
      if (run.clock() > run.deadline) { run.timedOut = true; return; }
      await onDoc(doc, doc.data() || {});
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
  await scan(run, run.db.collection(T).where('tourDate', '<=', cutoffYmd(run, MONTH)), 'tourDate', async (doc, d) => {
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
  await scan(run, run.db.collection(T).where('dateStart', '<=', cutoffYmd(run, MONTH)), 'dateStart', async (doc, d) => {
    const paths = topLevelPaths(d, R.BOOKING_TRIP_KEYS);
    if (!paths.length) return run.tally(T, 'alreadyClean');
    if (!R.bookingSettled(d.status)) return run.tally(T, 'heldStatus');
    const end = R.tripEndYmd(d.dateStart, [d.dateEnd]);
    if (!end) return run.tally(T, 'noDate');
    if (!R.isDue(end, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    if (run.claim(T)) await scrubPaths(run, T, doc.ref, paths);
  });
}

/** 결제 기록 안 사본 — 문서는 남긴다(used_paypal_orders 는 이중 결제 잠금). 문서 번호 = PayPal 주문 번호. */
async function sweepPaymentCopy(run, T, query, orderField, under, { holdUnresolved = false } = {}) {
  await scan(run, query, orderField, async (doc, d) => {
    const paths = R.findKeyPaths(d, R.PAYMENT_COPY_TRIP_KEYS, { under, maxDepth: 1 });
    if (!paths.length) return run.tally(T, 'alreadyClean');
    if (holdUnresolved && (d.resolvedAt === null || d.resolvedAt === undefined)) return run.tally(T, 'heldUnresolved');
    const body = under.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), d) || {};
    const end = R.tripEndYmd(body.tourDate, [await snapshotEnd(run.db, doc.id)]);
    if (!end) return run.tally(T, 'noDate');
    if (!R.isDue(end, MONTH, run.nowMs)) return run.tally(T, 'notYet');
    if (run.claim(T)) await scrubPaths(run, T, doc.ref, paths);
  });
}

async function sweepCartOrders(run) {
  const T = 'cart_orders';
  await scan(run, run.db.collection(T).where('createdAt', '<=', cutoffDate(run, MONTH)), 'createdAt', async (doc, d) => {
    const lines = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.some(line => topLevelPaths(line?.booking, R.PAYMENT_COPY_TRIP_KEYS).length)) return run.tally(T, 'alreadyClean');
    if (String(d.status || '').trim().toLowerCase() === 'payment_review') return run.tally(T, 'heldStatus');
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
  await scan(run, run.db.collection(T).where('date', '<=', cutoffYmd(run, MONTH)), 'date', async (doc, d) => {
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

// ── 문서 통째로 지우는 곳 ───────────────────────────────────────────────────
/**
 * baseOf(data) = 기준 시각, 또는 baseYmd(data, id) = 기준 한국 날짜. hold(data, id) = 건너뛸 이유 또는 null.
 * holdWhenDue(data, id) = 때가 된 문서만 한 번 더 보는 (비싼) 확인, 건너뛸 이유 또는 null. countOnly = 세기만.
 */
async function sweepWholeDocs(run, T, { query, orderField, period, baseOf, baseYmd = null, hold = () => null, holdWhenDue = null, countOnly = false, before = null }) {
  await scan(run, query, orderField, async (doc, d) => {
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

function wholeDocTargets(run, { complainedPlanIds }) {
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
    target('cs_tickets', 'createdAt', cutoffDate(run, THREE_YEARS), THREE_YEARS, { baseOf: d => d.createdAt }),
    target('plan_complaints', 'createdAt', cutoffDate(run, THREE_YEARS), THREE_YEARS, { baseOf: d => d.createdAt }),
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
      hold: (d, id) => (d.uid !== null ? 'member' : complainedPlanIds.has(id) ? 'heldComplaint'
        : R.paidPlan(d) && !R.isDue(R.msToKstYmd(d.createdAtMs), R.PAID_PLAN_MIN, run.nowMs) ? 'heldPaid' : null) }],
    // 입금 확인을 기다리는 수동 결제 신청 = 신청 + 1개월에 문서 삭제(운영자 11/21). 확인된 신청은 위 예약 규칙(결제 칸 5년).
    // 이 신청은 "손님이 송금했다"는 신고다. PayPal 이 이 예약 번호로 돈을 보냈다는 기록(금액 불일치·확정 실패 등으로
    // 자동 확정이 안 된 것)이 있으면 돈 기록이라 남긴다(paypal-webhook.js 가 detail.bookingRef 로 남김).
    ['pending_bookings_unverified', {
      query: run.db.collection('pending_bookings').where('status', '==', 'AWAITING_VERIFICATION'),
      orderField: FieldPath.documentId(), period: MONTH, baseOf: d => d.createdAt,
      holdWhenDue: async (d, id) => ((await run.db.collection('paypal_webhook_log').where('detail.bookingRef', '==', id).limit(1).get()).empty
        ? null : 'heldPaymentSeen') }],
  ];
}

// ── 구글 시트 예약 장부 `시트1` (운영에서만) ──────────────────────────────────
/** 장부 N열(PayPal 주문 번호)로 예약 문서 찾기. 문서 번호가 주문 번호이거나, orderID 칸이 주문 번호. */
async function findBookingByOrderId(run, orderId) {
  if (!orderId) return null;
  const direct = await run.db.collection('bookings').doc(orderId).get();
  if (direct.exists) return { id: orderId, data: direct.data() || {} };
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
    if (run.clock() > run.deadline) { run.timedOut = true; break; }
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
  }
  if (!cells.length) return;
  await sheets.writeRetentionSheetCells('bookings', cells);
  run.tally(T, 'applied', new Set(cells.map(c => c.row)).size);
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
  if (!cells.length) return;
  await sheets.writeRetentionSheetCells('leads', cells);
  run.tally(T, 'applied', new Set(cells.map(c => c.row)).size);
}

async function guarded(run, target, fn) {
  try { await fn(); } catch (error) {
    run.errors.push(target); run.tally(target, 'error');
    // 오류 글은 손님 값이 섞일 수 있어 남기지 않는다 — 이름·코드만.
    console.warn('[privacy-retention] target failed:', target, error?.code || error?.name || 'error');
  }
}

export async function privacyRetentionSweepTask({ env = process.env, now = Date.now, clock = Date.now, db = null, sheets = null } = {}) {
  try {
    const nowMs = now();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return { ok: false, code: 'RETENTION_CLOCK_INVALID' };
    const mode = retentionMode(env);
    const database = db || (await import('../_shared/firebase-admin.js')).initAdminDb('privacy-retention');
    if (!database) return { ok: false, code: 'RETENTION_DB_UNAVAILABLE' };
    const run = makeRun({ db: database, nowMs, mode, clock });

    await guarded(run, 'bookings', () => sweepBookings(run));
    await guarded(run, 'pending_bookings', () => sweepPendingBookings(run));
    await guarded(run, 'used_paypal_orders', () => sweepPaymentCopy(run, 'used_paypal_orders',
      database.collection('used_paypal_orders').where('createdAtMs', '<=', cutoffMs(run, MONTH)), 'createdAtMs', ['intent', 'body']));
    await guarded(run, 'payment_reviews', () => sweepPaymentCopy(run, 'payment_reviews',
      database.collection('payment_reviews').where('createdAt', '<=', cutoffDate(run, MONTH)), 'createdAt', ['bookingPayload'],
      { holdUnresolved: true }));
    await guarded(run, 'cart_orders', () => sweepCartOrders(run));
    await guarded(run, 'mood_bookings', () => sweepMoodBookings(run));
    let complainedPlanIds = null;
    await guarded(run, 'plan_complaints_open', async () => { complainedPlanIds = await openComplaintPlanIds(run); });
    for (const [target, options] of wholeDocTargets(run, { complainedPlanIds: complainedPlanIds || new Set() })) {
      // 신고 목록을 못 읽었으면 비회원 일정은 건너뛴다(신고 걸린 일정을 지울 수 있어서).
      if (target === 'plans_guest' && !complainedPlanIds) { run.tally(target, 'heldComplaintUnknown'); continue; }
      await guarded(run, target, () => sweepWholeDocs(run, target, options));
    }
    // 시트는 운영 장부 하나뿐 — 미리보기·개발에서는 읽지도 않는다.
    if (env.VERCEL_ENV === 'production') {
      const sheetApi = sheets || await import('../_google-sheets.js');
      await guarded(run, 'sheet_bookings', () => sweepBookingSheet(run, sheetApi));
      await guarded(run, 'sheet_leads', () => sweepLeadsSheet(run, sheetApi));
    }

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
