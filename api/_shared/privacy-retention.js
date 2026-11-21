/**
 * 개인정보 보관 기간 규칙 — 날짜 계산과 "지울 칸 찾기"만 하는 순수 모듈 (I/O 없음).
 *
 * 운영자 결정 2026-11-20 (처리방침 제3조): 여행 준비 정보·예약 안 한 사람 연락처 = 1개월,
 * 결제·계약 기록 = 5년(문서·칸 남김), 불만·분쟁 = 3년. 칸별 표 = 작업 보고서
 * `reports/보관기간-자동삭제-칸표-20261121.md`. 실제 읽기·지우기는 `api/_crons/privacy-retention-sweep.js`.
 *
 * 날짜는 모두 한국 날짜(KST). 기간은 민법 제157·160조처럼 센다: 기준일 다음 날부터,
 * 월·년은 달력으로, 끝 달에 같은 날이 없으면 그 달 말일에 끝남 → 끝난 다음 날 0시(KST)부터 지울 수 있다.
 */

import { fixedPriceFor } from './mood-pricing.js';

export const RETENTION_VERSION = 1;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 결제 예약 문서엔 시작일만 있다. 끝날을 어디서도 못 찾으면 시작일 + 이만큼을 끝날로 본다(일찍 지우지 않게). */
export const UNKNOWN_END_BUFFER_DAYS = 14;

const fmt = (y, m0, d) => new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);

export function validYmd(value) {
  const m = typeof value === 'string' && YMD.exec(value);
  return Boolean(m) && fmt(+m[1], +m[2] - 1, +m[3]) === value;
}

export function kstYmd(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(ymd, days) {
  if (!validYmd(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return fmt(y, m - 1, d + days);
}

/** 기준일(KST 'YYYY-MM-DD') + 기간 → 지워도 되는 첫날. 예) 1/10 + 1개월 → 2/11, 1/31 + 1개월 → 3/1. */
export function deletableFrom(baseYmd, { months = 0, years = 0, days = 0 } = {}) {
  if (!validYmd(baseYmd)) return null;
  if (days) return addDays(baseYmd, days + 1);
  const total = months + years * 12;
  if (!(total > 0)) return null;
  const [y, m, d] = addDays(baseYmd, 1).split('-').map(Number);
  const targetY = y + Math.floor((m - 1 + total) / 12);
  const targetM0 = (m - 1 + total) % 12;
  const daysInTarget = new Date(Date.UTC(targetY, targetM0 + 1, 0)).getUTCDate();
  return d <= daysInTarget ? fmt(targetY, targetM0, d) : fmt(targetY, targetM0 + 1, 1);
}

export function isDue(baseYmd, period, nowMs) {
  const from = deletableFrom(baseYmd, period);
  const today = kstYmd(nowMs);
  return Boolean(from && today && today >= from);
}

/** Timestamp·Date·ms 숫자·ISO 문자열 → ms. 모르는 꼴은 null(= 날짜 없음, 지우지 않음). */
export function toMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string' && value) { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null; }
  return null;
}

export function msToKstYmd(value) { const ms = toMs(value); return ms === null ? null : kstYmd(ms); }

const latest = values => values.filter(validYmd).sort().pop() || null;

/**
 * 여행 끝날: 아는 끝날 중 가장 늦은 날. 시작일만 알면 시작일 + 14일. 둘 다 없으면 null.
 * 끝날이 시작일보다 앞이면(날짜를 뒤로 옮긴 예약의 옛 끝날) 끝날을 모르는 것으로 본다.
 */
export function tripEndYmd(startYmd, endCandidates = []) {
  const end = latest(endCandidates);
  if (end && (!validYmd(startYmd) || end >= startYmd)) return end;
  return validYmd(startYmd) ? addDays(startYmd, UNKNOWN_END_BUFFER_DAYS) : null;
}

/** 여러 시각 칸 중 가장 늦은 것(ms). 하나도 없으면 null. */
export function latestMs(...values) {
  const list = values.map(toMs).filter(ms => ms !== null);
  return list.length ? Math.max(...list) : null;
}

/** 시트 칸 → 다듬은 글자. 비었거나 없으면 ''. */
export const cellText = value => (value === null || value === undefined ? '' : String(value)).trim();

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 평범한 객체 안에서 이름이 keys 인 칸의 경로를 찾는다(배열·Timestamp 안으로는 안 들어감).
 * 찾은 칸 아래로는 더 내려가지 않는다. 결과 = [['airport'], ['intent', 'body', 'memo'], ...].
 */
export function findKeyPaths(data, keys, { under = [], maxDepth = 4 } = {}) {
  const wanted = new Set(keys);
  let root = data;
  for (const segment of under) root = isPlainObject(root) ? root[segment] : undefined;
  const out = [];
  const walk = (node, path) => {
    if (!isPlainObject(node) || path.length - under.length >= maxDepth) return;
    for (const [key, value] of Object.entries(node)) {
      if (wanted.has(key)) { if (value !== undefined) out.push([...path, key]); }
      else walk(value, [...path, key]);
    }
  };
  walk(root, [...under]);
  return out;
}

const EMAIL_KEY = /(^e|E)mails?$/;
/** 이메일 칸 경로(email·…Email·…Emails, 사본 안까지). 평범한 객체만 내려가고 찾은 칸 아래로는 안 내려간다. */
export function findEmailKeyPaths(data, maxDepth = 4) {
  const out = [];
  const walk = (node, path) => {
    if (!isPlainObject(node) || path.length >= maxDepth) return;
    for (const [key, value] of Object.entries(node)) {
      if (EMAIL_KEY.test(key)) { if (value !== undefined) out.push([...path, key]); }
      else walk(value, [...path, key]);
    }
  };
  walk(data, []);
  return out;
}

/** 배열 칸을 통째로 다시 쓸 때만 쓴다: 평범한 객체만 복사하며 keys 를 빼고, Timestamp 등은 그대로 둔다. */
export function withoutKeysDeep(value, keys) {
  const wanted = keys instanceof Set ? keys : new Set(keys);
  if (Array.isArray(value)) return value.map(item => withoutKeysDeep(item, wanted));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!wanted.has(key) && item !== undefined) out[key] = withoutKeysDeep(item, wanted);
  }
  return out;
}

// ── 지우는 칸 (여행 준비 정보). 나머지 칸은 결제·계약 기록으로 남는다. ──────────────────
/**
 * 예약·수동 결제 문서 맨 위 칸. 메신저 ID 는 memo("Messenger: …")와 itineraryData 안에 있다.
 * 기사 배정 칸(driver·driverChatId·dispatchedTo·dispatchedDriverId)은 남긴다 — 손님 정보가 아니라 기사 본인 정보이고
 * `/sales` 기사별 매출이 읽는다(telegram-webhook-admin.js). 손님 정보를 담은 배차 글(dispatch_messages)은 지운다.
 */
export const BOOKING_TRIP_KEYS = Object.freeze([
  'customerPhone', 'pickupLocation', 'dropoffLocation', 'hotelAddress',
  'airport', 'terminal', 'flightNumber', 'luggage', 'luggageSmall', 'luggageMedium', 'luggageLarge', 'luggageTotal',
  'memo', 'notes', 'itineraryData',
]);
/** 결제 기록 안 사본(used_paypal_orders.intent.body, payment_reviews.bookingPayload, cart_orders.lines[].booking). */
export const PAYMENT_COPY_TRIP_KEYS = Object.freeze([
  'customerPhone', 'pickupLocation', 'dropoffLocation', 'hotelAddress', 'airport', 'memo', 'itineraryData',
]);
/** 협력사 예약과 그 변경 이력·견적 사본. */
export const MOOD_TRIP_KEYS = Object.freeze([
  'origin', 'destination', 'waypoints', 'routeSnapshot', 'routeSchedule', 'note', 'influencerName',
]);

/** 끝난 예약만 비운다. 환불·취소 진행 중, 입금 확인 대기, 모르는 상태는 건너뛴다(개수만). */
const SETTLED_BOOKING_STATUSES = new Set(['confirmed', 'completed', 'canceled', 'cancelled', 'refunded', 'rejected']);
export const bookingSettled = status => SETTLED_BOOKING_STATUSES.has(String(status || '').trim().toLowerCase());

/**
 * 협력사 예약이 끝난 상태. `confirmed` = 운행 확정일 뿐 정산 전이다(정산 승인 때 `completed`).
 * 정산이 breakdown 정류장 수를 다시 읽으므로 정산 전에 비우면 정산이 409 로 막힌다. 정액(공항)은 정산이 없어 confirmed 도 끝.
 */
const SETTLED_MOOD_STATUSES = new Set(['completed', 'cancelled', 'canceled']);
/** 열린 승인·다툼(운영자 11/21: 정산 다툼이 열린 건은 건너뜀). changes_requested = 협력사가 수정 요청. */
const OPEN_CHANGE_APPROVALS = new Set(['pending', 'awaiting_mood', 'ready', 'changes_requested']);
/** 정산은 운영자가 제안을 거둔 것(withdrawn)도 아직 정산 안 끝남. */
const OPEN_SETTLEMENT_APPROVALS = new Set([...OPEN_CHANGE_APPROVALS, 'withdrawn']);
const lower = value => String(value || '').trim().toLowerCase();
export function moodBookingSettled(data) {
  const status = lower(data?.status);
  const settled = SETTLED_MOOD_STATUSES.has(status) || (status === 'confirmed' && fixedPriceFor(data?.serviceType) !== null);
  if (!settled) return false;
  return !OPEN_CHANGE_APPROVALS.has(lower(data?.bookingChangeApproval?.status))
    && !OPEN_SETTLEMENT_APPROVALS.has(lower(data?.settlementApproval?.status));
}

/**
 * 돈을 냈을 수 있는 비회원 AI 일정. 안 낸 것이 확실한 것(테스트·운영자 우회·무료 쿠폰)만 false.
 * 돈을 낸 뒤 일정 만들기가 멈춘 문서(streaming·error)엔 주문 번호가 없고 결제 출처는 기본값 'paypal' 이라
 * 주문 번호로는 못 가른다 → 모르면 낸 것으로 본다(운영자 11/21 "판단이 안 되면 남기는 쪽").
 */
const UNPAID_PLAN_SOURCES = new Set(['test', 'admin-bypass', 'ai-coupon']);
export const paidPlan = d => !(d?.isFreeCoupon || d?.isAdminBypass === true || UNPAID_PLAN_SOURCES.has(lower(d?.paymentSource)));
/** 돈 낸 비회원 일정은 만든 날 + 180일(PayPal 분쟁 기간)과 여행 끝 + 1개월 중 늦은 날까지 남긴다(운영자 11/21). */
export const PAID_PLAN_MIN = Object.freeze({ days: 180 });

/**
 * 결제 시도 기록(used_paypal_orders)이 끝났는지. 결제 복구(payment-fulfillment-recovery.js)는 저장된 intent 로만
 * 다시 돌리므로, 끝난 것만 intent 안 여행 준비 칸을 비운다: 마무리됨(finalized) · 돈이 안 나감(not_captured) ·
 * 격리(reviewQuarantined)는 결제 검토(payment_reviews)가 해결됐을 때만. 나머지(진행 중·모름)는 남긴다.
 */
export function paymentAttemptClosed(lock, review) {
  if (lock?.reviewQuarantined === true) return review?.resolvedAt !== null && review?.resolvedAt !== undefined;
  return lock?.finalized === true || lock?.captureState === 'not_captured';
}

/** 장바구니는 결제가 끝난(captured) 것만 비운다. created(결제 전 또는 결제 기록 못 남김)·payment_review 는 남긴다. */
export const cartPaid = status => lower(status) === 'captured';

/**
 * 결제 시도 기록이 "돈을 안 가져갔다"를 확실히 말하는가(운영자 11/22: 결제 전 장바구니는 이때만 지움).
 * not_captured 이면서 돈 증거(captureVerified·captureID·격리)가 하나도 없을 때만 true. 나머지(진행 중·모름·옛 꼴)는 false.
 */
export const attemptTookNoMoney = lock => lock?.captureState === 'not_captured'
  && lock?.reviewQuarantined !== true && !lock?.captureVerified && !lock?.captureID;

/**
 * 무료 플랜 신청 영수증 다운로드 URL → { bucket, path }. 우리 버킷의 `free_claims/{slug}/…` 파일만,
 * 나머지(다른 버킷·다른 경로·모르는 꼴)는 null(= 지우지 않고 그 신청도 남김).
 * 꼴: https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?alt=media&token=…
 */
export function freeClaimReceiptObject(raw, buckets) {
  let url;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') return null;
  const m = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
  if (!m || !buckets.has(m[1])) return null;
  let path;
  try { path = decodeURIComponent(m[2]); } catch { return null; }
  const parts = path.split('/');
  if (parts[0] !== 'free_claims' || parts.length < 3 || parts.some(p => !p || p === '.' || p === '..')) return null;
  return { bucket: m[1], path };
}

/**
 * 불만·분쟁 기록(3년)은 처리를 마친 것만 지운다(운영자 11/22). 처리 중이거나 모르는 상태는 남긴다.
 * plan_complaints: open | reviewed | resolved (submit-plan-complaint.js) · cs_tickets: open | in_progress | resolved (telegram-webhook-admin.js).
 */
export const disputeClosed = status => lower(status) === 'resolved';

/** 비회원 AI 일정 끝날: input.startDate + durationDays - 1. 일수를 모르면 시작일 + 14일. */
export function planTripEndYmd(input) {
  const start = input?.startDate;
  const days = Number(input?.durationDays);
  if (validYmd(start) && Number.isInteger(days) && days > 0) return addDays(start, days - 1);
  return tripEndYmd(start, []);
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 구글 시트 칸 → 한국 날짜. 시트는 날짜를 숫자(1899-12-30 부터 센 날)로 돌려주거나(UNFORMATTED_VALUE),
 * 글자로 둔다('2026-10-01', '2026. 10. 1', ISO 시각). 모르는 꼴은 null(= 지우지 않음).
 */
export function sheetDateYmd(value) {
  if (typeof value === 'number') {
    if (!(value > 0)) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY_MS).toISOString().slice(0, 10);
  }
  const text = cellText(value);
  // 시각이 붙은 글자는 시간대까지 적힌 ISO 꼴만 믿는다(Date.parse 는 아무 글자나 서버 시간대로 읽는다).
  if (text.includes('T')) return ISO_WITH_ZONE.test(text) ? msToKstYmd(text) : null;
  const m = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/.exec(text);
  if (!m) return null;
  const ymd = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return validYmd(ymd) ? ymd : null;
}

/** 시트 `Leads` 줄의 동향용 시각 = 한국 달(YYYY-MM). 사람을 알아볼 수 없게 날짜·시각은 버린다. */
export function kstMonth(ms) { const ymd = kstYmd(ms); return ymd ? ymd.slice(0, 7) : null; }
export const MONTH_ONLY = /^\d{4}-\d{2}$/;
/** 'YYYY-MM' → 그 달 말일. */
export function monthEndYmd(month) {
  if (!MONTH_ONLY.test(String(month)) || !validYmd(`${month}-01`)) return null;
  const [y, m] = month.split('-').map(Number);
  return fmt(y, m, 0);
}

/** inquiry-response-workflow 등과 같은 종료 상태(처리 끝난 견적 문의). */
const TERMINAL_INQUIRY_STATUSES = new Set(['rejected', 'responded', 'closed', 'converted']);
export const inquiryClosed = status => TERMINAL_INQUIRY_STATUSES.has(String(status || '').trim().toLowerCase());

/** 쿼리 범위용(일 단위는 그 일수): 기간이 아무리 짧아도 이보다 최근 것은 볼 필요가 없다(1개월 ≥ 28일, 30일 기간 ≥ 30일). */
export const scanCutoffMs = (nowMs, period) => nowMs - (period.years ? 365 * period.years : period.days || 28 * (period.months || 1)) * DAY_MS;
