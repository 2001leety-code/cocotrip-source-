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

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeekKST(date) {
  const d = new Date(date);
  const day = d.getUTCDay();  // 0=Sunday
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonthKST(date) {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfYearKST(date) {
  const d = new Date(date);
  d.setUTCMonth(0, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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

  const nowDate = new Date(now);
  const todayStart = new Date(nowDate); todayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = startOfWeekKST(nowDate);
  const monthStart = startOfMonthKST(nowDate);
  const yearStart = startOfYearKST(nowDate);

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
    today: sumBucket(all.filter((b) => inWindow(b, todayStart.getTime()))),
    week:  sumBucket(all.filter((b) => inWindow(b, weekStart.getTime()))),
    month: sumBucket(all.filter((b) => inWindow(b, monthStart.getTime()))),
    ytd:   sumBucket(all.filter((b) => inWindow(b, yearStart.getTime()))),
  };

  // 일별 (최근 N일)
  const dailyMap = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(nowDate); d.setUTCDate(d.getUTCDate() - i); d.setUTCHours(0, 0, 0, 0);
    dailyMap.set(isoDay(d), { date: isoDay(d), usd: 0, count: 0 });
  }
  for (const b of all) {
    if (b.status === 'CANCELED') continue;
    if (!b._createdAtMs) continue;
    const d = new Date(b._createdAtMs); d.setUTCHours(0, 0, 0, 0);
    const key = isoDay(d);
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
    if (!inWindow(b, monthStart.getTime())) continue;
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
