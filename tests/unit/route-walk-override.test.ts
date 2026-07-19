// 도보 override 3중 가드 회귀 테스트 (2026-07-19).
// 운영자 신고: "각 장소 이동이 다 도보로만 표시" — 실측 플랜 9f42660f 에서
// 공항행 1560m(33분)·호텔행 1472m/1165m 도보 확인. 원인은 walk-first override 가
// "직선 1.5km 미만이면 무조건 도보"였던 것. 아래 케이스가 재발을 막는다.
import { describe, it, expect } from 'vitest';
import { shouldOverrideToWalk, MAX_WALK_OVERRIDE_MIN } from '../../api/_ai_core/agents/RouteAgent.js';

describe('shouldOverrideToWalk — 도보 override 가드', () => {
  it('짧고 교통정보 없으면 도보로 덮는다 (기존 의도 유지: 북촌→인사동)', () => {
    expect(shouldOverrideToWalk({
      walkMin: 12, transitMin: null, fromName: 'Bukchon Hanok Village', toName: 'Insadong',
    })).toBe(true);
  });

  it('가드1 — 상한 초과 도보는 덮지 않는다 (직선 기반이라 실제 보행은 더 김)', () => {
    expect(shouldOverrideToWalk({
      walkMin: MAX_WALK_OVERRIDE_MIN + 1, transitMin: null, fromName: 'A', toName: 'B',
    })).toBe(false);
    // 실측 신고 사례: 33분 도보
    expect(shouldOverrideToWalk({
      walkMin: 33, transitMin: null, fromName: 'Grand Hyatt Seoul', toName: 'Some Place',
    })).toBe(false);
  });

  it('가드2 — 공항/역/터미널 구간은 짧아도 도보 강권 금지 (캐리어 전제)', () => {
    expect(shouldOverrideToWalk({
      walkMin: 10, transitMin: null, fromName: 'Grand Hyatt Seoul', toName: 'Incheon International Airport T1',
    })).toBe(false);
    expect(shouldOverrideToWalk({
      walkMin: 8, transitMin: null, fromName: 'Seoul Station', toName: 'Hotel',
    })).toBe(false);
    expect(shouldOverrideToWalk({
      walkMin: 9, transitMin: null, fromName: '서울역', toName: '명동 호텔',
    })).toBe(false);
  });

  it('가드3 — 대중교통이 더 빠르면 덮지 않는다 (지하철 8분 vs 도보 20분)', () => {
    expect(shouldOverrideToWalk({
      walkMin: 20, transitMin: 8, fromName: '동묘앞', toName: '한강진',
    })).toBe(false);
  });

  it('가드3 — 도보가 같거나 빠르면 덮는다 (대기·환승 포함 시 도보 우위)', () => {
    expect(shouldOverrideToWalk({ walkMin: 9, transitMin: 12, fromName: 'A', toName: 'B' })).toBe(true);
    expect(shouldOverrideToWalk({ walkMin: 10, transitMin: 10, fromName: 'A', toName: 'B' })).toBe(true);
  });

  it('walkMin 이 숫자가 아니면 덮지 않는다 (좌표 결손 방어)', () => {
    expect(shouldOverrideToWalk({ walkMin: NaN, transitMin: null, fromName: 'A', toName: 'B' })).toBe(false);
    expect(shouldOverrideToWalk({ walkMin: undefined as unknown as number, transitMin: null, fromName: 'A', toName: 'B' })).toBe(false);
  });

  it('상한 경계값은 포함(<=)이다', () => {
    expect(shouldOverrideToWalk({ walkMin: MAX_WALK_OVERRIDE_MIN, transitMin: null, fromName: 'A', toName: 'B' })).toBe(true);
  });
});
