/**
 * 수정팀(운영 감시원) — 순수 체크 함수. 자가운영 에이전시 P2 심화. AI 0=$0, 읽기전용.
 *
 * 2026-06-10. 매일 어제 데이터를 다시 검산해 "틀린 금액·미아 주문·에러 폭증"을 findings 로 반환.
 * cron(ops-watchdog.js)이 findings 를 의사결정 큐 카드 + 심각시 텔레그램으로. **수정은 절대 자동 X(사람 승인).**
 *
 * 🔴 가격 감사 정직한 범위 (오탐 0 우선):
 *  - 쿠폰은 가격을 깎기만 함 → **단방향 검사**: 청구 > 정가 = 명백한 오과금(쿠폰 무관). 청구 < 정가는 쿠폰 가능성 → flag 안 함.
 *  - durationDays/originKey/applied-discount 미저장 → ai_planner_full(USD primary)·day_tour(durationDays)·
 *    transfer/multiday/tour_hourly 는 v1 가격감사 불가 = "감사 사각지대"로 카운트만(v2: booking 에 quoted price 저장 후).
 *  - 감사 가능 = KRW 고정가(airport_/combo_/kpop_shuttle_). resolveKrwAmount(SSOT) **import**(복제 금지=오과금 재발 함정 회피).
 */
import { resolveKrwAmount, CHARTER_MAP } from './resolve-line-item.js';
import { isAdminBypassBooking, isOperatorTestEmail } from './admin-bypass-detector.js';

export const PRICE_TOLERANCE_RATIO = 0.02; // 청구가가 정가의 +2% 초과면 오과금 (USD↔KRW 라운딩 흡수)

/** 상품의 가격 감사 종류. krw_fixed 만 v1 감사. */
export function priceAuditKind(productType) {
  const n = String(productType || '').replace(/-/g, '_');
  if (n === 'ai_planner_full') return 'usd_primary';        // $9.90 USD primary → KRW 비교 부정확
  if (CHARTER_MAP[n]) return 'duration_dependent';          // day_tour × durationDays(미저장)
  if (n.startsWith('airport_') || n.startsWith('combo_') || n.startsWith('kpop_shuttle')) return 'krw_fixed';
  return 'unsupported';                                       // transfer/multiday/tour_hourly (입력 미저장)
}

/** ① 💰 결제 invariant — 청구가 무결성 + 단방향 오과금. 읽기전용. */
export function checkPaymentInvariants(bookingDocs = [], SPEC, opts = {}) {
  const tol = opts.toleranceRatio != null ? opts.toleranceRatio : PRICE_TOLERANCE_RATIO;
  const findings = [];
  let blindspot = 0, audited = 0;
  for (const b of bookingDocs) {
    if (!b || String(b.status || '').toUpperCase() !== 'CONFIRMED') continue;
    if (isAdminBypassBooking(b) || isOperatorTestEmail(b.payerEmail || b.userEmail)) continue; // 운영자 테스트 제외
    const usd = parseFloat(b.amountUSD) || 0;
    if (usd <= 0) {
      findings.push({ severity: 'critical', kind: 'integrity', orderID: b.orderID || b.id, productType: b.productType, msg: `결제액 0/음수 ($${usd})` });
      continue;
    }
    const kind = priceAuditKind(b.productType);
    if (kind !== 'krw_fixed') { blindspot++; continue; }
    const listKrw = resolveKrwAmount(SPEC, b.productType, b.paxCount || 1, 1);
    if (listKrw == null || listKrw <= 0) { blindspot++; continue; }
    audited++;
    const krw = Number(b.amountKRW) || 0;
    const limit = listKrw * (1 + tol) + 1;
    if (krw > limit) { // 단방향: 정가 초과 청구 = 오과금(쿠폰은 깎기만 하므로 정가 초과 불가)
      const over = Math.round(krw - listKrw);
      findings.push({
        severity: over > 500000 ? 'critical' : 'warning', kind: 'overcharge',
        orderID: b.orderID || b.id, productType: b.productType, krw, listKrw, over,
        msg: `청구 ₩${krw.toLocaleString()} > 정가 ₩${listKrw.toLocaleString()} (+₩${over.toLocaleString()})`,
      });
    }
  }
  return { findings, blindspot, audited };
}

/** ② 📍 상태 invariant — 결제 후 plan 미생성(streaming stuck). SAFETY-critical. */
export function checkStuckStreamingPlans(planDocs = [], opts = {}) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const thresholdMs = opts.thresholdMs != null ? opts.thresholdMs : 30 * 60 * 1000;
  const findings = [];
  for (const p of planDocs) {
    if (!p || String(p.status) !== 'streaming') continue;
    const startedMs = Number(p._streaming_started_at) || Number(p.createdAtMs) || 0;
    if (startedMs <= 0) continue;
    const ageMin = Math.round((nowMs - startedMs) / 60000);
    if (nowMs - startedMs > thresholdMs) {
      findings.push({
        severity: 'critical', kind: 'plan-stuck', planId: p.id,
        ageMin, uid: p.uid || '', email: p.userEmail || p.email || '',
        msg: `plan ${p.id} ${ageMin}분째 streaming (결제 후 미인도 의심)`,
      });
    }
  }
  return { findings };
}

const TRANSIENT_KEYS = /^(unknown|timeout|503|429|network)/i;

/** ③ 🛠️ 운영 invariant — 같은 errorKey 폭증(절대 임계, baseline 없음 = 오탐 적음). */
export function checkErrorSurge(errorDocs = [], opts = {}) {
  const warnAt = opts.warnAt != null ? opts.warnAt : 4;
  const critAt = opts.critAt != null ? opts.critAt : 10;
  const byKey = {};
  for (const e of errorDocs) {
    if (!e) continue;
    const key = String(e.key || e.context || 'unknown').slice(0, 40);
    if (TRANSIENT_KEYS.test(key)) continue; // 일시 네트워크 오류 제외
    byKey[key] = (byKey[key] || 0) + 1;
  }
  const findings = [];
  for (const [key, count] of Object.entries(byKey)) {
    if (count >= critAt) findings.push({ severity: 'critical', kind: 'error-surge', key, count, msg: `${key} ${count}회 (임계 ${critAt})` });
    else if (count >= warnAt) findings.push({ severity: 'warning', kind: 'error-surge', key, count, msg: `${key} ${count}회 (임계 ${warnAt})` });
  }
  return { findings };
}

/**
 * ④ 🚦 교통 서비스 만료·한도 감시 — 만료/소진 전에 미리 알림(매끄러운 전환). 운영자 받적(2026-06-10).
 * @param {object} services - transitServiceConfig.TRANSIT_SERVICES
 * @param {{nowMs?:number, activeKey?:string, plansYesterday?:number, callsPerPlan?:number, warnDays?:number, critDays?:number}} opts
 */
export function checkTransitService(services, opts = {}) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const activeKey = opts.activeKey || 'odsay';
  const plansYesterday = Number(opts.plansYesterday) || 0;
  const callsPerPlan = opts.callsPerPlan != null ? opts.callsPerPlan : 18.8;
  const warnDays = opts.warnDays != null ? opts.warnDays : 30;
  const critDays = opts.critDays != null ? opts.critDays : 7;
  const findings = [];
  const svc = services && services[activeKey];
  if (!svc) return { findings };

  // 만료 임박 (활성 서비스). KST 자정 기준.
  if (svc.expiryDate) {
    const expMs = Date.parse(`${svc.expiryDate}T00:00:00+09:00`);
    if (Number.isFinite(expMs)) {
      const daysLeft = Math.floor((expMs - nowMs) / 86_400_000);
      if (daysLeft <= critDays) findings.push({ severity: 'critical', kind: 'transit-expiry', daysLeft, msg: `${svc.label} ${daysLeft}일 후 만료(${svc.expiryDate}) — 갱신/전환 필요` });
      else if (daysLeft <= warnDays) findings.push({ severity: 'warning', kind: 'transit-expiry', daysLeft, msg: `${svc.label} ${daysLeft}일 후 만료(${svc.expiryDate}) — 갱신/전환 준비` });
    }
  }

  // 일 한도 사용량 추정 (어제 플랜수 × 호출/플랜). 유료(dailyQuotaCalls=null)는 감시 제외.
  if (svc.dailyQuotaCalls) {
    const estCalls = Math.round(plansYesterday * callsPerPlan);
    const ratio = estCalls / svc.dailyQuotaCalls;
    if (ratio >= 0.9) findings.push({ severity: 'critical', kind: 'transit-quota', estCalls, msg: `${svc.label} 한도 임박 — 어제 추정 ${estCalls}회 / ${svc.dailyQuotaCalls}회 (${Math.round(ratio * 100)}%) — 유료 전환 필요` });
    else if (ratio >= 0.7) findings.push({ severity: 'warning', kind: 'transit-quota', estCalls, msg: `${svc.label} 한도 ${Math.round(ratio * 100)}% — 어제 추정 ${estCalls}회 / ${svc.dailyQuotaCalls}회 — 유료 준비` });
  }
  return { findings };
}

/**
 * ⑤ 🔐 서비스/자격증명 수명 감시 — 만료·rotation 갱신 N일 전 미리 알림(조용히 터지는 것 방지). 운영자 받적(2026-06-10).
 * @param {Array} registry - serviceRegistry.SERVICE_REGISTRY
 * @param {{nowMs?:number, warnDays?:number, critDays?:number}} opts
 */
export function checkServiceRenewals(registry = [], opts = {}) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const warnDays = opts.warnDays != null ? opts.warnDays : 30;
  const critDays = opts.critDays != null ? opts.critDays : 7;
  const findings = [];
  for (const s of (Array.isArray(registry) ? registry : [])) {
    if (!s || !s.key || s.kind === 'info') continue;
    const dateStr = s.kind === 'rotation' ? s.lastRotated : s.expiryDate;
    if (!dateStr) {
      // 날짜 미기록 → 1회 안내(운영자가 날짜 채우면 자동 감시 시작). 멱등 dedupe 로 1회만.
      findings.push({ severity: 'warning', kind: 'service-renewal', service: s.key, undated: true, msg: `${s.label} ${s.kind === 'rotation' ? '마지막 갱신일' : '만료일'} 미기록 — 날짜 기록하면 자동 알림. ${s.note || ''}`.trim() });
      continue;
    }
    const base = Date.parse(`${dateStr}T00:00:00+09:00`);
    if (!Number.isFinite(base)) continue;
    const dueMs = s.kind === 'rotation' ? base + (s.rotationDays || 365) * 86_400_000 : base;
    const daysLeft = Math.floor((dueMs - nowMs) / 86_400_000);
    if (daysLeft <= critDays) findings.push({ severity: 'critical', kind: 'service-renewal', service: s.key, daysLeft, msg: `${s.label} ${daysLeft <= 0 ? '갱신/만료 경과 — 즉시 조치' : daysLeft + '일 후 갱신/만료'} — ${s.note || ''}`.trim() });
    else if (daysLeft <= warnDays) findings.push({ severity: 'warning', kind: 'service-renewal', service: s.key, daysLeft, msg: `${s.label} ${daysLeft}일 후 갱신/만료 — ${s.note || ''}`.trim() });
  }
  return { findings };
}
