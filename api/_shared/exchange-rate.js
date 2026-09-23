/**
 * _shared/exchange-rate.js — 고정 환율 상수
 *
 * 2026-09-24 운영자 결정: 신규 판매·표시 환율은 가격 정본의 1350원/USD.
 * 이미 완료된 거래의 저장 금액·환율은 각 호출부에서 우선하며 재가격하지 않는다.
 */
import { loadPricingSpec } from './pricing.js';

// 신규 판매·표시의 고정 환율. 기존 거래의 저장 금액/환율은 해당 호출부에서 우선한다.
export const USD_TO_KRW = (loadPricingSpec() || {}).charter_usd_fix_rate || 1350;
export function usdToKrw(usd) { return Math.round(usd * USD_TO_KRW); }
export function krwToUsd(krw) { return Math.round((krw / USD_TO_KRW) * 100) / 100; }
