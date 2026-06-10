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

const PRODUCT_BUCKETS = ['픽업', '셔틀', '투어', '전세', 'AI플래너'];

/**
 * 어제 회사 지표 집계.
 * @param {{ bookingDocs?:Array, planDocs?:Array, userDocs?:Array }} snapshots - doc.data() 평탄화 + {id}.
 * @param {{ now: Date }} ctx - now = 실 현재 Date.
 */
export function aggregateMorningBriefing({ bookingDocs = [], planDocs = [], userDocs = [] } = {}, { now } = {}) {
  const { yStartMs, todayStartMs } = kstYesterdayWindow(now || new Date());
  const inY = (ms) => ms != null && ms >= yStartMs && ms < todayStartMs;

  const byProduct = {};
  for (const k of PRODUCT_BUCKETS) byProduct[k] = { usd: 0, count: 0 };

  let revUsd = 0, revCount = 0, excludedBypass = 0, excludedCanceled = 0;
  for (const b of bookingDocs) {
    if (!inY(toMs(b.createdAt))) continue;
    if (isAdminBypassBooking(b) || isOperatorTestEmail(b.userEmail || b.payerEmail)) { excludedBypass++; continue; }
    if (String(b.status || '').toUpperCase() === 'CANCELED') { excludedCanceled++; continue; }
    const amt = parseFloat(b.amountUSD) || 0;
    revUsd += amt; revCount++;
    const bucket = byProduct[classifyProduct(b.productType)] || byProduct['전세'];
    bucket.usd += amt; bucket.count++;
  }
  for (const k of PRODUCT_BUCKETS) byProduct[k].usd = round2(byProduct[k].usd);

  let paidPlan = 0;
  for (const p of planDocs) {
    const ms = toMs(p.createdAtMs != null ? p.createdAtMs : p.createdAt);
    if (!inY(ms)) continue;
    if (String(p.status) !== 'ready') continue;          // 완성 플랜만
    if (p.isAdminBypass === true) continue;               // 운영자 바이패스 제외
    const src = String(p.paymentSource || '');
    if (src === 'test' || src === 'admin-bypass') continue;
    if (p.paypalOrderId && isAdminBypassOrderId(p.paypalOrderId)) continue;
    paidPlan++;
  }

  let newUsers = 0;
  for (const u of userDocs) {
    if (!inY(toMs(u.createdAt))) continue;
    if (u.role && u.role !== 'user') continue;            // admin 등 제외
    newUsers++;
  }

  return {
    window: { yStartMs, todayStartMs },
    revenue: { usd: round2(revUsd), count: revCount },
    byProduct,
    aiPlanner: { paidCount: paidPlan, feeUsd: round2(paidPlan * AI_FEE_USD) },
    newUsers,
    meta: { excludedBypass, excludedCanceled },
  };
}
