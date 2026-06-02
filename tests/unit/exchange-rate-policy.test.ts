/**
 * 환율 정책(applyRatePolicy) 회귀 가드 + 클라이언트 폴백 SSOT 일치 (2026-06-02, FINANCIAL).
 *
 * 배경: ProfitSettlement(월별 손익) 가 stale 1380 을 기본 환율로 박아둬, 실시간 환율을 쓰는
 *       매출 대시보드(admin-sales)와 다른 숫자를 보이던 drift 발견 (운영자 "환율은 실시간 아냐?").
 *       → 실시간 fetch(/api/exchange-rate) + 폴백을 정책 floor 1450 으로 통일.
 *
 * 이 테스트가 고정하는 것:
 *   1. applyRatePolicy 의 운영자 정책 (floor 1450 / sanity max 2000, 2026-05-13) — 누가 floor 를
 *      1380 으로 되돌리거나 지우면 fail.
 *   2. 클라이언트 폴백 상수 DEFAULT_KRW_PER_USD == 서버 정책 floor — 두 화면 폴백이 다시 drift 하면 fail.
 */
import { describe, it, expect } from 'vitest';
import { applyRatePolicy } from '../../api/_exchange-rate.js';
import { DEFAULT_KRW_PER_USD } from '../../src/lib/profitSettlement';

const RATE_FLOOR = 1450;       // 운영자 정책 2026-05-13
const RATE_SANITY_MAX = 2000;
const FALLBACK_RATE = 1450;

describe('applyRatePolicy — 운영자 환율 정책 (floor 1450 / sanity max 2000)', () => {
  it('floor 미만 → floor (1450) 로 끌어올림 (USD underprice 방지)', () => {
    expect(applyRatePolicy(1380)).toBe(RATE_FLOOR); // ← 옛 stale 값도 floor 로 보정됨
    expect(applyRatePolicy(1400)).toBe(RATE_FLOOR);
    expect(applyRatePolicy(1)).toBe(RATE_FLOOR);
  });

  it('floor ~ sanity max 사이 → 실시세 그대로 (위로 cap 없음)', () => {
    expect(applyRatePolicy(1450)).toBe(1450);
    expect(applyRatePolicy(1492.5)).toBe(1492.5);
    expect(applyRatePolicy(1800)).toBe(1800);
    expect(applyRatePolicy(2000)).toBe(2000);
  });

  it('sanity max 초과 → fetch 오류로 간주, FALLBACK (1450)', () => {
    expect(applyRatePolicy(2001)).toBe(FALLBACK_RATE);
    expect(applyRatePolicy(5000)).toBe(FALLBACK_RATE);
  });

  it('NaN / 0 / 음수 → FALLBACK (1450)', () => {
    expect(applyRatePolicy(NaN)).toBe(FALLBACK_RATE);
    expect(applyRatePolicy(0)).toBe(FALLBACK_RATE);
    expect(applyRatePolicy(-100)).toBe(FALLBACK_RATE);
  });

  it('RATE_SANITY_MAX 상수 동기화 (정책 문서값과 일치)', () => {
    expect(applyRatePolicy(RATE_SANITY_MAX)).toBe(RATE_SANITY_MAX);   // 경계: 통과
    expect(applyRatePolicy(RATE_SANITY_MAX + 0.01)).toBe(FALLBACK_RATE); // 경계+ : 폴백
  });
});

describe('클라이언트 폴백 SSOT 일치 — drift 재발 차단', () => {
  it('DEFAULT_KRW_PER_USD == 서버 정책 floor (1450), stale 1380 아님', () => {
    expect(DEFAULT_KRW_PER_USD).toBe(RATE_FLOOR);
    expect(DEFAULT_KRW_PER_USD).not.toBe(1380); // 회귀: 옛 stale 값으로 되돌리면 fail
  });

  it('클라이언트 폴백을 서버 정책에 통과시켜도 동일 (양측 폴백 일치)', () => {
    // 실시간 fetch 실패 시 클라(DEFAULT_KRW_PER_USD)와 서버(applyRatePolicy 폴백)가 같은 숫자여야 함.
    expect(applyRatePolicy(DEFAULT_KRW_PER_USD)).toBe(DEFAULT_KRW_PER_USD);
    expect(applyRatePolicy(1)).toBe(DEFAULT_KRW_PER_USD); // 서버 floor 보정 결과 == 클라 폴백
  });
});
