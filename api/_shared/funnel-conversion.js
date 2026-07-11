/**
 * 무료→유료 전환 집계 (PR-C, 2026-07-11 마케팅 지시서) — 순수 함수 (테스트 가능).
 *
 * 연결 키: 무료 플랜 email(guestEmail/email) → 이후 CONFIRMED bookings 의
 * userEmail/payerEmail (소문자). bookings 엔 uid 가 없어 이메일 연결
 * (docs/ANALYTICS-FUNNEL.md). 윈도우: 무료 플랜 최초 생성 시각 +7일/+30일 내 결제.
 * 채널 = booking.attribution.first.utm_source (P1 스냅샷, 없으면 'direct').
 */

const DAY_MS = 24 * 3600 * 1000;

/**
 * @param {Array<{guestEmail?:string,email?:string,createdAtMs?:number,createdAt?:string}>} freePlans
 * @param {Array<{status?:string,userEmail?:string,payerEmail?:string,createdAtMs:number,attribution?:object,productType?:string}>} bookings
 *   bookings[].createdAtMs — caller 가 Firestore Timestamp 를 ms 로 변환해 전달.
 */
export function computeFreeToPaidConversion(freePlans, bookings) {
  const out = {
    freeUserBase: 0, converted7d: 0, converted30d: 0, rate7d: 0, rate30d: 0,
    byChannel: {}, byProduct: {},
    note: '무료 AI플랜 사용자 이메일 기준 — 이후 7/30일 내 차터·투어 결제 매칭',
  };
  const freeByEmail = new Map(); // email -> earliest free plan ms
  for (const d of freePlans || []) {
    const em = String(d.guestEmail || d.email || '').toLowerCase().trim();
    const ms = d.createdAtMs || (d.createdAt ? Date.parse(d.createdAt) : 0);
    if (!em || !ms) continue;
    if (!freeByEmail.has(em) || freeByEmail.get(em) > ms) freeByEmail.set(em, ms);
  }
  out.freeUserBase = freeByEmail.size;
  if (!freeByEmail.size) return out;

  const seen7 = new Set(); const seen30 = new Set();
  for (const b of bookings || []) {
    if (b.status && b.status !== 'CONFIRMED') continue;
    const em = String(b.userEmail || b.payerEmail || '').toLowerCase().trim();
    const freeMs = em && freeByEmail.get(em);
    if (!freeMs) continue;
    const bMs = b.createdAtMs || 0;
    if (!bMs || bMs <= freeMs) continue; // 무료 플랜 "이후" 결제만
    const days = (bMs - freeMs) / DAY_MS;
    if (days <= 30 && !seen30.has(em)) {
      seen30.add(em);
      const ch = (b.attribution && b.attribution.first && b.attribution.first.utm_source) || 'direct';
      const pt = b.productType || 'unknown';
      out.byChannel[ch] = (out.byChannel[ch] || 0) + 1;
      out.byProduct[pt] = (out.byProduct[pt] || 0) + 1;
    }
    if (days <= 7 && !seen7.has(em)) seen7.add(em);
  }
  out.converted7d = seen7.size;
  out.converted30d = seen30.size;
  out.rate7d = Math.round((seen7.size / freeByEmail.size) * 100);
  out.rate30d = Math.round((seen30.size / freeByEmail.size) * 100);
  return out;
}
