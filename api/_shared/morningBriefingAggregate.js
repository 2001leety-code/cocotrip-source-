/**
 * 모닝 브리핑 집계 — 순수 함수 (Firestore fetch / 시계 / 네트워크 분리 = 단위 테스트 100%, 머지 전 검증).
 *
 * 2026-06-10: 자가운영 에이전시 P1 "비서". AI 0% — 순수 코드 집계 = 비용 $0 + 벤더 독립.
 * 어제(KST) 실데이터: 예약 실매출(상품별) + AI 플래너 유료 + 신규 가입.
 * 운영자 본인 테스트 결제(admin-bypass / 운영자 이메일) 제외 = SSOT admin-bypass-detector.
 *
 * ⚠️ KST 경계: off-by-9h trap 회피. KST 달력일(00:00~24:00)을 실 UTC epoch 로 정확히 산출
 *    (admin-sales 의 setUTCHours 패턴은 09:00 시작이 되는 경향 — 본 모듈은 달력일 정확).
 */
import { classifyProduct } from './adminSalesAggregate.js';
import { isAdminBypassBooking, isAdminBypassOrderId, isOperatorTestEmail } from './admin-bypass-detector.js';

// AI 플래너 정책 수수료(USD). daily-report 와 동일 값. priceUSD(추정 여행가)와 다름 — 그건 매출 아님.
export const AI_FEE_USD = 9.90;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Firestore Timestamp | epoch ms(number) | {_seconds} | ISO string → 실 epoch ms(UTC). 실패 시 null. */
export function toMs(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  if (typeof ts.toDate === 'function') { const d = ts.toDate(); return d ? d.getTime() : null; }
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts === 'string') { const t = Date.parse(ts); return Number.isFinite(t) ? t : null; }
  return null;
}

/**
 * KST '어제' 실 epoch 경계 [yStartMs, todayStartMs).
 * @param {Date} nowReal - 실 현재 시각 Date (KST-shift 아님 — 호출자 계약: new Date()).
 * @returns {{ yStartMs:number, todayStartMs:number }}
 */
export function kstYesterdayWindow(nowReal) {
  const base = nowReal instanceof Date ? nowReal.getTime() : Number(nowReal) || Date.now();
  const kst = new Date(base + 9 * 3600 * 1000); // KST 벽시계 (UTC fields = KST)
  const Y = kst.getUTCFullYear(), M = kst.getUTCMonth(), D = kst.getUTCDate();
  // KST 오늘 00:00 의 실 UTC epoch = (그 날짜를 UTC 로 본 자정) − 9h.
  const todayStartMs = Date.UTC(Y, M, D, 0, 0, 0) - 9 * 3600 * 1000;
  const yStartMs = todayStartMs - 24 * 3600 * 1000;
  return { yStartMs, todayStartMs };
}

/** KST 이번 주 월요일 00:00 의 실 epoch (재무 주간 누적용). */
export function kstWeekStartMs(nowReal) {
  const base = nowReal instanceof Date ? nowReal.getTime() : Number(nowReal) || Date.now();
  const kst = new Date(base + 9 * 3600 * 1000);
  const sinceMon = (kst.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const todayKstMidnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0) - 9 * 3600 * 1000;
  return todayKstMidnight - sinceMon * 24 * 3600 * 1000;
}

/** KST 이번 달 1일 00:00 의 실 epoch (재무 월간 누적용). */
export function kstMonthStartMs(nowReal) {
  const base = nowReal instanceof Date ? nowReal.getTime() : Number(nowReal) || Date.now();
  const kst = new Date(base + 9 * 3600 * 1000);
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1, 0, 0, 0) - 9 * 3600 * 1000;
}

/** 실매출 booking 판정 (운영자 테스트·취소 제외). SSOT. */
function isRealRevenueBooking(b) {
  if (isAdminBypassBooking(b) || isOperatorTestEmail(b.userEmail || b.payerEmail)) return false;
  if (String(b.status || '').toUpperCase() === 'CANCELED') return false;
  return true;
}

/** [startMs, endMs) 구간 실매출 합산 (재무 주간/월간 추세용). */
function sumRevenue(bookingDocs, startMs, endMs) {
  let usd = 0, count = 0;
  for (const b of bookingDocs) {
    const ms = toMs(b.createdAt);
    if (ms == null || ms < startMs || ms >= endMs) continue;
    if (!isRealRevenueBooking(b)) continue;
    usd += parseFloat(b.amountUSD) || 0; count++;
  }
  return { usd: round2(usd), count };
}

/** 🛠️ 운영 감시원 — error_log(telegram-throttle 적재) 어제 집계. createdAt = epoch ms. */
export function aggregateErrors(errorDocs = [], startMs, endMs) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byKey = {};
  let total = 0;
  for (const e of errorDocs) {
    const ms = toMs(e.createdAt);
    if (ms == null || ms < startMs || ms >= endMs) continue;
    total++;
    const sev = String(e.severity || '').toLowerCase();
    if (sev in bySeverity) bySeverity[sev]++;
    const key = String(e.key || e.context || 'unknown').slice(0, 40);
    byKey[key] = (byKey[key] || 0) + 1;
  }
  const top = Object.entries(byKey).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, count]) => ({ key, count }));
  return { total, bySeverity, top };
}

const PRODUCT_BUCKETS = ['픽업', '셔틀', '투어', '전세', 'AI플래너'];

/**
 * 어제 회사 지표 집계 — 사무실 4직원(재무·운영·고객) + 신규가입·AI.
 * 마케팅(PostHog)은 네트워크라 cron 에서 별도 fetch 후 메시지에 합침(여기 미포함).
 * @param {{ bookingDocs?:Array, planDocs?:Array, userDocs?:Array, errorDocs?:Array, cstDocs?:Array }} snapshots
 *   - bookingDocs 는 추세용으로 ~30일치(이번달 1일 이전 포함) 전달 권장. 내부서 어제/주간/월간 분리.
 * @param {{ now: Date }} ctx - now = 실 현재 Date.
 */
export function aggregateMorningBriefing({ bookingDocs = [], planDocs = [], userDocs = [], errorDocs = [], cstDocs = [] } = {}, { now } = {}) {
  const nr = now || new Date();
  const { yStartMs, todayStartMs } = kstYesterdayWindow(nr);
  const weekStartMs = kstWeekStartMs(nr);
  const monthStartMs = kstMonthStartMs(nr);
  const inY = (ms) => ms != null && ms >= yStartMs && ms < todayStartMs;

  // 💰 재무 — 어제 매출(상품별) + 리뷰요청 발송 카운트(고객).
  const byProduct = {};
  for (const k of PRODUCT_BUCKETS) byProduct[k] = { usd: 0, count: 0 };
  let revUsd = 0, revCount = 0, excludedBypass = 0, excludedCanceled = 0, reviewsSent = 0;
  for (const b of bookingDocs) {
    const rs = toMs(b.reviewRequestSent); // 배치 B 가 마크. 그 전엔 항상 0.
    if (rs != null && rs >= yStartMs && rs < todayStartMs) reviewsSent++;
    if (!inY(toMs(b.createdAt))) continue;
    if (isAdminBypassBooking(b) || isOperatorTestEmail(b.userEmail || b.payerEmail)) { excludedBypass++; continue; }
    if (String(b.status || '').toUpperCase() === 'CANCELED') { excludedCanceled++; continue; }
    const amt = parseFloat(b.amountUSD) || 0;
    revUsd += amt; revCount++;
    const bucket = byProduct[classifyProduct(b.productType)] || byProduct['전세'];
    bucket.usd += amt; bucket.count++;
  }
  for (const k of PRODUCT_BUCKETS) byProduct[k].usd = round2(byProduct[k].usd);

  // 재무 추세 — 이번 주/달 누적(어제까지). 30일치 bookingDocs 필요.
  const trends = {
    week: sumRevenue(bookingDocs, weekStartMs, todayStartMs),
    month: sumRevenue(bookingDocs, monthStartMs, todayStartMs),
  };

  // 🤖 AI 플래너 유료(어제).
  let paidPlan = 0;
  for (const p of planDocs) {
    const ms = toMs(p.createdAtMs != null ? p.createdAtMs : p.createdAt);
    if (!inY(ms)) continue;
    if (String(p.status) !== 'ready') continue;
    if (p.isAdminBypass === true) continue;
    const src = String(p.paymentSource || '');
    if (src === 'test' || src === 'admin-bypass') continue;
    if (p.paypalOrderId && isAdminBypassOrderId(p.paypalOrderId)) continue;
    paidPlan++;
  }

  // 👤 신규 가입(어제).
  let newUsers = 0;
  for (const u of userDocs) {
    if (!inY(toMs(u.createdAt))) continue;
    if (u.role && u.role !== 'user') continue;
    newUsers++;
  }

  // 🛠️ 운영 — 어제 오류.
  const errors = aggregateErrors(errorDocs, yStartMs, todayStartMs);

  // 💬 고객 — 어제 신규 문의(cs_tickets) + 리뷰요청 발송(위 reviewsSent).
  let newTickets = 0;
  for (const c of cstDocs) {
    if (inY(toMs(c.createdAt))) newTickets++;
  }

  return {
    window: { yStartMs, todayStartMs, weekStartMs, monthStartMs },
    revenue: { usd: round2(revUsd), count: revCount },
    trends,
    byProduct,
    aiPlanner: { paidCount: paidPlan, feeUsd: round2(paidPlan * AI_FEE_USD) },
    newUsers,
    errors,
    customer: { newTickets, reviewsSent },
    meta: { excludedBypass, excludedCanceled },
  };
}
