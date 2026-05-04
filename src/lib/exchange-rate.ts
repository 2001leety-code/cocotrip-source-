/**
 * exchange-rate.ts — 프론트엔드 고정 환율 상수
 *
 * 백엔드 `api/_shared/exchange-rate.js` 와 동일 값(1380) 유지.
 * 어드민 대시보드 등 라이브 조회가 비싸거나 불필요한 곳에서 사용.
 */
export const USD_TO_KRW = 1380;
export const usdToKrw = (usd: number) => Math.round(usd * USD_TO_KRW);
export const krwToUsd = (krw: number) => Math.round((krw / USD_TO_KRW) * 100) / 100;
