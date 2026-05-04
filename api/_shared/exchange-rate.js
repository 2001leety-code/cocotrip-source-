/**
 * _shared/exchange-rate.js — 고정 환율 상수
 *
 * 비즈니스 로직: 라이브 환율 조회는 `api/_exchange-rate.js`의 `getUsdToKrwRaw()`
 * 사용. 본 모듈은 라이브 조회가 부적절한 컨텍스트(텔레그램 매출 요약, 어드민
 * 통계 대시보드, booking-processor 폴백 등)에서 쓰이는 **고정 환율**을 제공.
 *
 * USD ↔ KRW 환율. 필요 시 API 연동으로 업그레이드 가능.
 */
export const USD_TO_KRW = 1380;
export function usdToKrw(usd) { return Math.round(usd * USD_TO_KRW); }
export function krwToUsd(krw) { return Math.round((krw / USD_TO_KRW) * 100) / 100; }
