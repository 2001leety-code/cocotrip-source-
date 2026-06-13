/**
 * MOOD 운행 종료 정산 — mood-settle 엔드포인트 보안/멱등 + 프론트 배선 소스가드 (2026-06-14).
 *
 * 가예약(confirmed)을 실제 시간으로 최종 정산: 시급×max(3,실제) + 원래 거리/톨비 재사용 →
 * 차액만 잔액 조정(트랜잭션) → completed + 최종 영수증. 멱등(이미 정산 거부), 공항 제외.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/mood-settle.js'), 'utf8');

describe('mood-settle 엔드포인트 — 보안·정산 가드', () => {
  it('운영자 전용 — verifyUserToken + emailVerified + isAdminEmail', () => {
    expect(src).toContain('verifyUserToken');
    expect(src).toMatch(/emailVerified/);
    expect(src).toMatch(/isAdminEmail\(allowlist, email\)/);
  });

  it('멱등 — status!==confirmed 거부 (ALREADY_SETTLED)', () => {
    expect(src).toMatch(/b\.status\s*!==\s*'confirmed'/);
    expect(src).toContain('ALREADY_SETTLED');
  });

  it('공항(정액) 제외 — fixedPriceFor 가드', () => {
    expect(src).toMatch(/fixedPriceFor\(b\.serviceType\)\s*!==\s*null/);
    expect(src).toContain('AIRPORT_NO_SETTLE');
  });

  it('최종금액 = computeMoodTotalKRW(실제시간, 원래 거리/톨비 재사용)', () => {
    expect(src).toMatch(/computeMoodTotalKRW\(\{[\s\S]{0,160}durationHours:\s*actualHours/);
    expect(src).toMatch(/km:\s*Number\(bd\.km\)/);
    expect(src).toMatch(/tollKRW:\s*Number\(bd\.tollKRW\)/);
  });

  it('차액만 잔액 조정 (트랜잭션) + completed + 정산 영수증', () => {
    expect(src).toContain('runTransaction');
    expect(src).toMatch(/diff\s*=\s*finalAmount\s*-\s*originalAmount/);
    expect(src).toMatch(/balanceKRW:\s*newBalance/);
    expect(src).toMatch(/status:\s*'completed'/);
    expect(src).toContain('buildMoodSettlementReceiptEmail');
  });

  it('nullish 연산자 미사용 (mojibake 가드)', () => {
    expect(src.includes(String.fromCharCode(63, 63))).toBe(false);
  });
});

describe('MoodPortal — 운행 종료 정산 배선', () => {
  const portal = readFileSync(resolve(process.cwd(), 'src/pages/MoodPortal.tsx'), 'utf8');
  it('handleSettle → /api/mood-settle', () => {
    expect(portal).toContain('handleSettle');
    expect(portal).toContain('/api/mood-settle');
  });
  it('ledger 에 운행 종료 버튼 (confirmed·시간제만)', () => {
    expect(portal).toMatch(/운행 종료/);
    expect(portal).toMatch(/b\.status === 'confirmed' && b\.serviceType !== 'airport'/);
  });
});
