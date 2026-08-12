/**
 * MOOD 운행 종료 정산 — mood-settle 엔드포인트 보안/멱등/거리재측정 + 상세 영수증 (2026-06-14).
 *
 * 가예약(confirmed)을 실제 시간으로 최종 정산: 시급×max(3,실제) + (추가 방문지로 재측정한 / 없으면
 * 예약 시) 거리·톨비 → 차액만 잔액 조정(트랜잭션) → completed + 상세 영수증. 멱등(이미 정산 거부), 공항 제외.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMoodSettlementReceiptEmail } from '../../api/_shared/mood-receipt.js';

const src = readFileSync(resolve(process.cwd(), 'api/mood-settle.js'), 'utf8');

describe('mood-settle 엔드포인트 — 보안·정산 가드', () => {
  it('운영자 전용 — verifyUserToken + emailVerified + isAdminEmail', () => {
    expect(src).toContain('verifyUserToken');
    expect(src).toMatch(/emailVerified/);
    expect(src).toMatch(/isAdminEmail\(allowlist, email\)/);
  });

  it('멱등 — status!==confirmed 거부 (ALREADY_SETTLED, 트랜잭션 내 재확인)', () => {
    expect(src).toMatch(/b\.status\s*!==\s*'confirmed'/); // tx 안 멱등 가드
    expect(src).toContain('ALREADY_SETTLED');
    expect(src).toContain('runTransaction');
  });

  it('공항(정액) 제외 — fixedPriceFor 가드', () => {
    expect(src).toMatch(/fixedPriceFor\(\w+\.serviceType\)\s*!==\s*null/);
    expect(src).toContain('AIRPORT_NO_SETTLE');
  });

  it('최종금액 = computeMoodTotalKRW(실제시간, 재측정/재사용 거리·톨비) — 백엔드 SSOT', () => {
    expect(src).toMatch(/computeMoodTotalKRW\(\{[\s\S]{0,160}durationHours:\s*actualHours/);
    // km/tollKRW 는 route 재측정 또는 예약값 재사용 변수 (기본값 = 예약 시 측정치)
    expect(src).toMatch(/let\s+km\s*=\s*preBd\.km/);
    expect(src).toMatch(/let\s+tollKRW\s*=\s*preBd\.tollKRW/);
  });

  it('추가 방문지 → computeRoute 로 실제 거리 재측정 (override 있을 때만)', () => {
    expect(src).toContain("from './_shared/mood-route.js'");
    expect(src).toMatch(/hasRouteOverride/);
    expect(src).toMatch(/computeRoute\(\{\s*origin:\s*newOrigin/);
    // 재측정 실패는 비치명적 — 예약 거리 유지
    expect(src).toMatch(/routeError/);
    expect(src).toMatch(/recomputed:\s*true/);
  });

  it('차액만 잔액 조정 (트랜잭션) + completed + 상세 정산 영수증', () => {
    expect(src).toMatch(/diff\s*=\s*finalAmount\s*-\s*originalAmount/);
    expect(src).toMatch(/balanceKRW:\s*newBalance/);
    expect(src).toMatch(/status:\s*'completed'/);
    expect(src).toContain('buildMoodSettlementReceiptEmail');
    // 상세 영수증에 예약↔실제 비교 + 재측정 여부 전달
    expect(src).toMatch(/bookedHours:/);
    expect(src).toMatch(/actualKm:/);
    expect(src).toMatch(/routeRecomputed:/);
  });

  it('nullish 연산자 미사용 (mojibake 가드)', () => {
    expect(src.includes(String.fromCharCode(63, 63))).toBe(false);
  });
});

describe('buildMoodSettlementReceiptEmail — 무엇이 추가됐는지 분해', () => {
  it('예약→실제 비교 + 항목별 분해 + 거리 재측정 명시', () => {
    const r = buildMoodSettlementReceiptEmail({
      clientName: '무드', bookingId: 'BK1', date: '2026-06-20', startTime: '10:00',
      serviceType: 'vehicle',
      bookedHours: 8, actualHours: 10,
      bookedKm: 30, actualKm: 52,
      ratePerHour: 33000, baseKRW: 330000, distanceSurchargeKRW: 13200, tollKRW: 4500,
      bookedAmountKRW: 264000, finalAmountKRW: 347700, adjustmentKRW: 83700, newBalance: 500000,
      routeRecomputed: true, waypointCount: 2,
    });
    // 시간 초과 + 거리 증가 표시
    expect(r.html).toContain('8시간');
    expect(r.html).toContain('10시간');
    expect(r.html).toContain('+2시간');
    expect(r.html).toContain('52km');
    expect(r.html).toContain('추가 방문지 2곳');
    // 항목별 분해
    expect(r.html).toContain('기본요금');
    expect(r.html).toContain('거리 추가요금');
    expect(r.html).toContain('톨비');
    // 조정/잔액
    expect(r.html).toContain('조정');
    expect(r.text).toContain('재측정');
    expect(r.subject).toContain('최종 정산');
  });

  it('경로 없는 정산(거리 0) — km 행 생략, 크래시 없음', () => {
    const r = buildMoodSettlementReceiptEmail({
      clientName: '무드', bookingId: 'BK2', date: '2026-06-21', startTime: '14:00',
      serviceType: 'manager',
      bookedHours: 5, actualHours: 5,
      bookedKm: 0, actualKm: 0,
      ratePerHour: 44000, baseKRW: 220000, distanceSurchargeKRW: 0, tollKRW: 0,
      bookedAmountKRW: 220000, finalAmountKRW: 220000, adjustmentKRW: 0, newBalance: 100000,
      routeRecomputed: false, waypointCount: 0,
    });
    expect(r.html).toContain('기본요금');
    expect(r.html).not.toContain('거리 추가요금');
    expect(r.html).toContain('조정 없음');
  });
});

describe('MoodPortal — 운행 종료 정산 + 추가 방문지 배선', () => {
  const portal = readFileSync(resolve(process.cwd(), 'src/pages/MoodPortal.tsx'), 'utf8');
  it('handleSettle → /api/mood-settle (실제 경로 payload 포함)', () => {
    expect(portal).toContain('handleSettle');
    expect(portal).toContain('/api/mood-settle');
    expect(portal).toMatch(/routePayload/);
  });
  it('정산 폼에 실제 방문 경로 입력(출발·방문지·도착) + 예약 경로 prefill', () => {
    expect(portal).toMatch(/실제 방문 경로/);
    expect(portal).toMatch(/setSettleOrigin/);
    expect(portal).toMatch(/addSettleWaypoint/);
    expect(portal).toMatch(/b\.breakdown\?\.origin/);
  });
  it('ledger 운행 종료 버튼 (confirmed·시간제만)', () => {
    expect(portal).toMatch(/운행 종료/);
    expect(portal).toMatch(/b\.status === 'confirmed' && b\.serviceType !== 'airport'/);
  });
});
