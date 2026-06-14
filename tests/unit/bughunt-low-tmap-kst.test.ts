/**
 * 버그헌트 LOW (2026-06-14): TMAP buildSearchDttm 이 서버 UTC 시계로 야간/주간 보정 →
 * KST 와 9시간 어긋남 회귀 슈트.
 *
 * 버그: buildSearchDttm(opts) 가 now 인자·opts.departDttm 없이 호출됨(RouteAgent.js:2207,
 *   recalc-transit.js:181). Vercel serverless = UTC 시계 → now.getHours()=KST−9. 결과:
 *   - KST 09:00 (UTC 00:00, hh=0) 을 야간으로 오인 → 10:00 강제
 *   - KST 22:00 (UTC 13:00, hh=13) 을 주간으로 취급 → 야간 컷오프 미적용
 *   TMAP 만 영향(현재 prod=tmap). 금액 영향 없음, 플랜 정확도 저하.
 *
 * fix: 야간 보정 전 now 를 +9h 하여 KST 로 변환 후 getUTC* 로 연/월/일/시/분 도출
 *   (recordRecalcStat / adminSalesAggregate 의 +9h 패턴과 동일).
 *
 * ⚠️ now 를 항상 'UTC instant' 로 구성(Date.UTC)해서 테스트가 러너 로컬 타임존에 무관하게 통과.
 */
import { describe, it, expect } from 'vitest';
import { buildSearchDttm } from '../../api/_tmap_helper.js';

/** 주어진 KST 벽시계(year,monthIndex,day,hour,minute) 에 해당하는 UTC instant Date. */
function kstWallClock(y: number, mo0: number, d: number, h: number, mi: number): Date {
  // KST = UTC + 9h → 해당 KST 순간의 UTC epoch = Date.UTC(KST) − 9h
  return new Date(Date.UTC(y, mo0, d, h, mi) - 9 * 60 * 60 * 1000);
}

describe('buildSearchDttm — KST 변환 (버그헌트 LOW)', () => {
  it('KST 09:00 (UTC 00:00) 은 주간 → 10:00 강제 안 됨 (야간 오인 회귀)', () => {
    // 2026-06-14 09:00 KST  ==  2026-06-14 00:00 UTC (hh=0 → 옛 버그면 야간 오인)
    const now = kstWallClock(2026, 5, 14, 9, 0);
    expect(buildSearchDttm({}, now)).toBe('202606140900');
  });

  it('KST 22:00 (UTC 13:00) 은 야간 → 10:00 강제됨 (주간 오인 회귀)', () => {
    // 2026-06-14 22:00 KST  ==  2026-06-14 13:00 UTC (hh=13 → 옛 버그면 주간 취급)
    const now = kstWallClock(2026, 5, 14, 22, 0);
    expect(buildSearchDttm({}, now)).toBe('202606141000');
  });

  it('KST 06:30 (새벽) 은 야간 보정 → 10:00', () => {
    const now = kstWallClock(2026, 5, 14, 6, 30);
    expect(buildSearchDttm({}, now)).toBe('202606141000');
  });

  it('KST 14:30 (주간) 은 보정 없이 그대로', () => {
    const now = kstWallClock(2026, 5, 14, 14, 30);
    expect(buildSearchDttm({}, now)).toBe('202606141430');
  });

  it('KST 자정 직후(00:30) 야간 보정 시 날짜는 KST 기준 당일', () => {
    // 2026-06-14 00:30 KST  ==  2026-06-13 15:30 UTC → 옛 버그면 hh=15 주간 + 날짜 6/13
    const now = kstWallClock(2026, 5, 14, 0, 30);
    expect(buildSearchDttm({}, now)).toBe('202606141000');
  });

  it('날짜 경계: KST 23:00 → 야간 보정 + 날짜 KST 당일 유지', () => {
    // 2026-06-14 23:00 KST == 2026-06-14 14:00 UTC. 옛 버그면 UTC 날짜 6/14 우연히 같으나 hh=14 주간
    const now = kstWallClock(2026, 5, 14, 23, 0);
    expect(buildSearchDttm({}, now)).toBe('202606141000');
  });

  it('연/월 경계: 2026-01-01 00:30 KST 은 KST 당일(0101) 기준', () => {
    // == 2025-12-31 15:30 UTC → 옛 버그면 20251231..., KST fix 면 20260101...
    const now = kstWallClock(2026, 0, 1, 0, 30);
    expect(buildSearchDttm({}, now)).toBe('202601011000');
  });

  it('opts.departDttm(12자리) 명시 시 now/KST 무시하고 그대로 사용', () => {
    const now = kstWallClock(2026, 5, 14, 22, 0);
    expect(buildSearchDttm({ departDttm: '202612250830' }, now)).toBe('202612250830');
  });

  it('opts.departDttm 형식 불량(12자리 아님) 은 무시 → KST 보정 경로', () => {
    const now = kstWallClock(2026, 5, 14, 14, 30);
    expect(buildSearchDttm({ departDttm: 'bad' }, now)).toBe('202606141430');
  });
});
