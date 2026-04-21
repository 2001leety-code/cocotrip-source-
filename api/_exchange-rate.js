/**
 * _exchange-rate.js — 환율 조회 공통 유틸
 *
 * 사용처: applyPromoCode, booking-processor, createPaypalOrder, daily-report
 * 비즈니스 로직:
 *   - 기본 API: frankfurter.app (무료, 안정적)
 *   - 폴백 API: exchangerate-api.com
 *   - cap: 최대 1350 (사업자 보호 — 환율 높으면 쿠폰 할인 커짐)
 *   - fallback: 1350 (API 모두 실패 시)
 */

const RATE_CAP = 1350;
const FALLBACK_RATE = 1350;

/**
 * USD→KRW 환율 조회 (cap 적용)
 * @param {{ cap?: number, timeout?: number }} opts
 * @returns {Promise<number>} 환율
 */
export async function getUsdToKrw(opts = {}) {
  const cap = opts.cap ?? RATE_CAP;
  const timeout = opts.timeout ?? 4000;

  // 1차: frankfurter.app
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW', {
      signal: AbortSignal.timeout(timeout),
    });
    if (res.ok) {
      const rate = (await res.json()).rates?.KRW;
      if (rate && rate > 0) return Math.min(rate, cap);
    }
  } catch { /* try fallback */ }

  // 2차: exchangerate-api.com
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: AbortSignal.timeout(timeout),
    });
    if (res.ok) {
      const rate = (await res.json()).rates?.KRW;
      if (rate && rate > 0) return Math.min(rate, cap);
    }
  } catch { /* use fallback */ }

  return FALLBACK_RATE;
}

/**
 * USD→KRW 환율 조회 (cap 없음 — booking-processor용 실제 환율)
 * @returns {Promise<number>}
 */
export async function getUsdToKrwRaw() {
  return getUsdToKrw({ cap: Infinity });
}
