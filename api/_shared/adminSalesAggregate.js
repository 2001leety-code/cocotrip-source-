/**
 * Admin Sales Aggregation — PURE financial computation extracted from api/admin-sales.js.
 *
 * 비유: "식당 매출 계산기" 의 순수 계산부만 분리 — Firestore fetch / 인증 / 시계(now) /
 * 환율 같은 부수효과는 admin-sales.js handler 에 남기고, "이미 받아온 booking 배열 →
 * KPI / 일별 / 상품별 / 최근" 변환만 여기서 담당. 동일 입력 → 동일 출력 (deterministic).
 *
 * ⚠️ BEHAVIOR-PRESERVING (test/admin-financial-coverage):
 *   admin-sales.js 가 인라인으로 갖고 있던 집계 로직을 byte-identical 하게 옮긴 것.
 *   period boundary (KST 기준 today/week/month/ytd), TEST-/ADMIN-BYPASS- 제외 규칙,
 *   CANCELED 제외, USD 반올림(소수 2자리), 일별 N일 window, 상품별 = 이번달, 최근 20건
 *   정렬/매핑 — 전부 원본과 동일. 값/임계치/공식 변경 0.
 *
 * SSOT 제외 규칙: _shared/admin-bypass-detector.js (isAdminBypassBooking).
 *
 * 입력 booking shape: admin-sales.js 가 Firestore doc 을 normalize 한 형태
 *   { id, ...docData, _createdAtMs: number|null }
 *   (createdAt → epoch ms 변환은 handler 의 bookingDateMs() 책임 — 시계/Timestamp 의존이라 여기 미포함.)
 */
import { isAdminBypassBooking } from './admin-bypass-detector.js';

// KST 자정 오프셋. KST 달력일(UTC 필드로 표현) → 실 UTC epoch 경계 = Date.UTC(Y,M,D,...) − 9h.
// (morningBriefingAggregate.js 의 kstYesterdayWindow 와 동일 SSOT 로직 — off-by-9h trap 회피.)
const KST_OFFSET_MS = 9 * 3600 * 1000;

// KST 벽시계 Date(kstWall) 의 달력일 → 그 날 00:00 의 실 UTC epoch (ms).
// kstWall 은 handler 가 넘긴 todayKST() = new Date(Date.now()+9h) — UTC 필드 = KST 벽시계.
function kstMidnightEpoch(kstWall, { year, month, day } = {}) {
  const Y = year != null ? year : kstWall.getUTCFullYear();
  const M = month != null ? month : kstWall.getUTCMonth();
  const D = day != null ? day : kstWall.getUTCDate();
  return Date.UTC(Y, M, D, 0, 0, 0) - KST_OFFSET_MS;
}

// 실 UTC epoch(ms) → KST 달력일 라벨 YYYY-MM-DD. (+9h 후 UTC 필드 추출.)
function isoKstDay(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function startOfWeekKST(kstWall) {
  const day = kstWall.getUTCDay();  // 0=Sunday (KST 벽시계 기준)
  return kstMidnightEpoch(kstWall) - day * 24 * 3600 * 1000;
}

function startOfMonthKST(kstWall) {
  return kstMidnightEpoch(kstWall, { day: 1 });
}

function startOfYearKST(kstWall) {
  return kstMidnightEpoch(kstWall, { month: 0, day: 1 });
}

export function classifyProduct(productType = '') {
  const p = productType.toString();
  if (/픽업|pickup/i.test(p)) return '픽업';
  if (/셔틀|shuttle/i.test(p)) return '셔틀';
  if (/planner|ai/i.test(p)) return 'AI플래너';
  if (/tour-/i.test(p)) return '투어';
  return '전세';
}

/**
 * 이미 normalize 된 booking 배열을 KPI/일별/상품별/최근 으로 집계.
 *
 * @param {Array<object>} rawAll - { id, ...docData, _createdAtMs } 형태 (handler normalize 결과)
 * @param {object} opts
 * @param {Date|number} opts.now - 집계 기준 시각 (handler 의 todayKST() = UTC+9 shift 된 Date). KST 경계 산출 기준.
 * @param {number} opts.days - 일별 window 길이 (handler 가 7~90 clamp 후 전달)
 * @returns {{ kpi, daily, byProduct, recent, totalBookings, excluded }}
 */
export function aggregateAdminSales(rawAll, { now, days }) {
  // A1-7-1 (2026-05-24): 운영자 본인 테스트 결제 (TEST-/ADMIN-BYPASS- prefix) 제외.
  // 비유: "식당 매출 계산기가 사장님 본인 시식까지 합산하던 것 → 분리".
  // paymentGate.js / planPersister.js / booking-processor.js 와 동일 prefix 규약 사용
  // (SSOT: _shared/admin-bypass-detector.js).
  const adminBypassBookings = rawAll.filter((b) => isAdminBypassBooking(b));
  const canceledBookings = rawAll.filter(
    (b) => b.status === 'CANCELED' && !isAdminBypassBooking(b)
  );
  const all = rawAll.filter((b) => !isAdminBypassBooking(b));

  const excludedMeta = {
    adminBypass: adminBypassBookings.length,
    canceled: canceledBookings.length,
  };

  // now = handler 의 todayKST() (= new Date(Date.now()+9h)) → UTC 필드가 KST 벽시계.
  // 모든 경계는 'KST 달력일 추출 → Date.UTC(...) − 9h = 실 UTC epoch' 로 산출 (off-by-9h fix).
  // _createdAtMs 는 진짜 UTC epoch 이므로 동일 시간축에서 비교됨.
  const nowDate = new Date(now);
  const todayStartMs = kstMidnightEpoch(nowDate);
  const weekStartMs = startOfWeekKST(nowDate);
  const monthStartMs = startOfMonthKST(nowDate);
  const yearStartMs = startOfYearKST(nowDate);

  const inWindow = (b, fromTs) => {
    if (!b._createdAtMs) return false;
    return b._createdAtMs >= fromTs;
  };

  const sumBucket = (rows) => {
    let usd = 0, count = 0;
    for (const b of rows) {
      if (b.status === 'CANCELED') continue;  // 취소 제외
      const a = parseFloat(b.amountUSD || '0') || 0;
      usd += a;
      count++;
    }
    return { usd: Math.round(usd * 100) / 100, count };
  };

  const kpi = {
    today: sumBucket(all.filter((b) => inWindow(b, todayStartMs))),
    week:  sumBucket(all.filter((b) => inWindow(b, weekStartMs))),
    month: sumBucket(all.filter((b) => inWindow(b, monthStartMs))),
    ytd:   sumBucket(all.filter((b) => inWindow(b, yearStartMs))),
  };

  // 일별 (최근 N일) — KST 달력일 버킷. 키 = 오늘 KST 자정 epoch 에서 i*24h 씩 뒤로 → KST 라벨.
  const dailyMap = new Map();
  for (let i = 0; i < days; i++) {
    const key = isoKstDay(todayStartMs - i * 24 * 3600 * 1000);
    dailyMap.set(key, { date: key, usd: 0, count: 0 });
  }
  for (const b of all) {
    if (b.status === 'CANCELED') continue;
    if (!b._createdAtMs) continue;
    const key = isoKstDay(b._createdAtMs);  // 실 UTC epoch → KST 달력일 (KST 00:00~09:00 도 오늘로)
    const entry = dailyMap.get(key);
    if (entry) {
      entry.usd += parseFloat(b.amountUSD || '0') || 0;
      entry.count++;
    }
  }
  const daily = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ ...e, usd: Math.round(e.usd * 100) / 100 }));

  // 상품별 (이번달 기준)
  const byProductMap = {};
  for (const b of all) {
    if (b.status === 'CANCELED') continue;
    if (!inWindow(b, monthStartMs)) continue;
    const cat = classifyProduct(b.productType);
    if (!byProductMap[cat]) byProductMap[cat] = { usd: 0, count: 0 };
    byProductMap[cat].usd += parseFloat(b.amountUSD || '0') || 0;
    byProductMap[cat].count++;
  }
  for (const k of Object.keys(byProductMap)) {
    byProductMap[k].usd = Math.round(byProductMap[k].usd * 100) / 100;
  }

  // 최근 20건
  const recent = all
    .filter((b) => b._createdAtMs)
    .sort((a, b) => b._createdAtMs - a._createdAtMs)
    .slice(0, 20)
    .map((b) => ({
      bookingRef: b.bookingRef || b.id,
      tourDate: b.tourDate || '',
      productType: b.productType || '',
      paxCount: b.paxCount || 0,
      amountUSD: parseFloat(b.amountUSD || '0') || 0,
      status: b.status || 'UNKNOWN',
      customerEmail: b.userEmail || b.payerEmail || '',
      createdAt: b._createdAtMs ? new Date(b._createdAtMs).toISOString() : null,
    }));

  return {
    kpi,
    daily,
    byProduct: byProductMap,
    recent,
    totalBookings: all.length,
    // A1-7-1: 매출 집계에서 제외된 건수 메타 — 운영자가 "왜 KPI 가 줄었는지" 즉시 인지.
    excluded: excludedMeta,
  };
}
