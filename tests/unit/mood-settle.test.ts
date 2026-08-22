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
import { appendMoodCoursePercentage } from '../../src/lib/moodBookingShare';

const src = readFileSync(resolve(process.cwd(), 'api/mood-settle.js'), 'utf8');
const respondSrc = readFileSync(resolve(process.cwd(), 'api/mood-settle-respond.js'), 'utf8');

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

  it('제안 엔드포인트는 잔액·완료 상태·영수증을 절대 건드리지 않는다', () => {
    // 🔴 이중 확인 계약: mood-settle.js 는 제안만 만든다. 잔액/완료/영수증은 승인 엔드포인트 몫.
    expect(src).toMatch(/diff\s*=\s*finalAmount\s*-\s*originalAmount/); // 델타 계산은 여기서 하되
    expect(src).not.toMatch(/tx\.update\(clientRef/);                    // 잔액은 쓰지 않는다
    expect(src).not.toMatch(/balanceKRW:\s*newBalance/);
    expect(src).not.toContain('balanceAfterKRW');   // 확정 잔액 스냅샷은 승인에서만 찍힌다
    expect(src).not.toContain('settledAt');
    expect(src).not.toContain('buildMoodSettlementReceiptEmail');
    expect(src).toMatch(/status:\s*'awaiting_mood'/);
  });

  it('승인 엔드포인트만 잔액·completed·상세 영수증을 커밋한다', () => {
    expect(respondSrc).toMatch(/tx\.update\(clientRef,\s*\{\s*balanceKRW:\s*newBalanceKRW\s*\}\)/);
    expect(respondSrc).toMatch(/status:\s*'completed'/);
    expect(respondSrc).toContain('buildMoodSettlementReceiptEmail');
    // 상세 영수증에 예약↔실제 비교 + 재측정 여부 전달
    expect(respondSrc).toMatch(/bookedHours:/);
    expect(respondSrc).toMatch(/actualKm:/);
    expect(respondSrc).toMatch(/routeRecomputed:/);
    // 실제 잔액·멱등·권한 동작은 mood-settle-respond.test.ts 가 실제 핸들러로 검증한다.
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
  const editor = readFileSync(resolve(process.cwd(), 'src/components/mood/MoodSettlementEditor.tsx'), 'utf8');
  it('서버 미리보기 뒤 같은 revision·지문으로 /api/mood-settle 확정', () => {
    expect(editor).toContain('/api/mood-settle-preview');
    expect(editor).toContain('/api/mood-settle');
    expect(editor).toMatch(/expectedRevision:\s*validPreview\.revision/);
    expect(editor).toMatch(/previewHash:\s*validPreview\.previewHash/);
  });
  it('실주행 직접 입력과 실제 방문 경로 재측정을 분리하고 서버 계산거리만 쓴다', () => {
    expect(editor).toMatch(/실주행 직접 입력/);
    expect(editor).toMatch(/주소로 재측정/);
    expect(editor).toMatch(/payload\.actualTotalKm/);
    expect(editor).toMatch(/payload\.excludedKm/);
    expect(editor).toMatch(/payload\.origin/);
    expect(editor).not.toMatch(/payload\.billableKm/);
  });
  it('방문지 추가는 0% 부담률을 100%로 바꾸지 않고, 미리보기 최종액으로 분담을 표시한다', () => {
    expect(appendMoodCoursePercentage([100, 0])).toEqual([100, 0, 0]);
    expect(appendMoodCoursePercentage([100, 50])).toEqual([100, 50, 50]);
    expect(editor).toMatch(/totalKRW=\{validPreview \? validPreview\.finalAmountKRW : booking\.amountKRW\}/);
  });
  it('ledger 운행 종료 버튼 (confirmed·시간제만)', () => {
    expect(portal).toMatch(/실제 이용 정산/);
    expect(portal).toMatch(/needsSettlement = b\.status === 'confirmed' && b\.serviceType !== 'airport'/);
  });
});
