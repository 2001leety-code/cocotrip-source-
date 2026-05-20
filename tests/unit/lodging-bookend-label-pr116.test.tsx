/**
 * P116 (2026-05-20) regression slot — lodging bookend role labeling.
 *
 * Source bug (plan 4792076e): 호텔 카드가 매일 첫 + 마지막 stop 으로 2번 노출.
 * 사용자 입장: "호텔이 2번 나와" 중복 버그로 오인. lodging bookend 패턴 의도이지만
 * UX 모호.
 *
 * Fix: StopCard 에 lodgingRole prop 추가, DayTimeline 이 stop 의 day 내 위치 +
 * intercity_transit 존재 여부로 role 결정. 호텔 카드에 작은 badge 표시:
 *   - checkout (city-change 첫 stop)
 *   - depart (일반 첫 stop)
 *   - return (마지막 stop)
 *   - checkin (중간 stop)
 *
 * Verifies (source-level + small unit):
 *   1. LodgingRole 타입 export
 *   2. 4 role 라벨 4-lang (ko/en/ja/zh)
 *   3. computeLodgingRole 결정 로직 (잘 알려진 4 케이스)
 *   4. 비-lodging stop → undefined (no badge)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STOP_CARD = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/components/StopCard.tsx'),
  'utf8',
);
const DAY_TIMELINE = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/components/DayTimeline.tsx'),
  'utf8',
);
const SORTABLE_CARD = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/components/SortableStopCard.tsx'),
  'utf8',
);

describe('P116 — source-level invariants (lodging role labeling)', () => {
  it('StopCard exports LodgingRole type with 4 canonical roles', () => {
    expect(STOP_CARD).toMatch(/export\s+type\s+LodgingRole\s*=\s*['"]checkout['"]\s*\|\s*['"]depart['"]\s*\|\s*['"]checkin['"]\s*\|\s*['"]return['"]/);
  });

  it('StopCard accepts lodgingRole prop on the component signature', () => {
    expect(STOP_CARD).toMatch(/lodgingRole\?:\s*LodgingRole/);
  });

  it('LODGING_ROLE_LABEL maps each role to 4-lang labels', () => {
    expect(STOP_CARD).toMatch(/checkout:\s*\{\s*ko:[^}]+,\s*en:[^}]+,\s*ja:[^}]+,\s*zh:/);
    expect(STOP_CARD).toMatch(/depart:\s*\{\s*ko:[^}]+,\s*en:[^}]+,\s*ja:[^}]+,\s*zh:/);
    expect(STOP_CARD).toMatch(/checkin:\s*\{\s*ko:[^}]+,\s*en:[^}]+,\s*ja:[^}]+,\s*zh:/);
    expect(STOP_CARD).toMatch(/return:\s*\{\s*ko:[^}]+,\s*en:[^}]+,\s*ja:[^}]+,\s*zh:/);
  });

  it('badge renders only when lodgingRole truthy (guarded)', () => {
    // Badge JSX must be inside `{lodgingRole && (...)}` guard
    expect(STOP_CARD).toMatch(/\{lodgingRole\s*&&\s*\(/);
  });

  it('DayTimeline declares computeLodgingRole helper inside component scope', () => {
    expect(DAY_TIMELINE).toMatch(/function\s+computeLodgingRole\s*\(/);
    expect(DAY_TIMELINE).toMatch(/computeLodgingRole\(stop,\s*si,\s*stops,\s*!!intercity\)/);
  });

  it('SortableStopCard forwards lodgingRole prop to StopCard', () => {
    expect(SORTABLE_CARD).toMatch(/lodgingRole\?:\s*LodgingRole/);
    expect(SORTABLE_CARD).toMatch(/<StopCard\s+stop=\{stop\}\s+lodgingRole=\{lodgingRole\}/);
  });
});

describe('P116 — computeLodgingRole behavior (re-implemented locally)', () => {
  // Mirror of DayTimeline's computeLodgingRole — same logic for direct test.
  function computeLodgingRole(
    stop: any, si: number, stopsArr: any[], hasIntercity: boolean,
  ): 'checkout' | 'depart' | 'checkin' | 'return' | undefined {
    if (stop.category !== 'lodging') return undefined;
    const isFirst = si === 0;
    const isLast = si === stopsArr.length - 1;
    if (isFirst) return hasIntercity ? 'checkout' : 'depart';
    if (isLast) return 'return';
    return 'checkin';
  }

  const lodging = { category: 'lodging', name: '명동 호텔' };
  const food = { category: 'food', name: '식당' };

  it('non-lodging stop returns undefined regardless of position', () => {
    expect(computeLodgingRole(food, 0, [food, lodging], false)).toBeUndefined();
    expect(computeLodgingRole(food, 1, [lodging, food], false)).toBeUndefined();
  });

  it('first stop + intercity_transit present → checkout (다른 도시 출발 전)', () => {
    const stops = [lodging, food, lodging];
    expect(computeLodgingRole(lodging, 0, stops, true)).toBe('checkout');
  });

  it('first stop + no intercity_transit → depart (일반 출발)', () => {
    const stops = [lodging, food, lodging];
    expect(computeLodgingRole(lodging, 0, stops, false)).toBe('depart');
  });

  it('last stop → return (취침 복귀) regardless of intercity', () => {
    const stops = [lodging, food, lodging];
    expect(computeLodgingRole(lodging, 2, stops, false)).toBe('return');
    expect(computeLodgingRole(lodging, 2, stops, true)).toBe('return');
  });

  it('middle stop lodging → checkin (city-change day 새 호텔)', () => {
    // Day3 의 stop3 = 해운대 호텔 (Busan 도착 후 체크인)
    const stops = [lodging, food, lodging, food, lodging];
    expect(computeLodgingRole(lodging, 2, stops, true)).toBe('checkin');
  });

  it('single-stop day with one lodging stop → first === last → return takes priority? actually first wins', () => {
    // edge case: stops = [lodging] only — si=0 (first) AND si=last (length-1=0).
    // 현재 로직: isFirst 체크가 먼저 → return depart (or checkout)
    const stops = [lodging];
    expect(computeLodgingRole(lodging, 0, stops, false)).toBe('depart');
    expect(computeLodgingRole(lodging, 0, stops, true)).toBe('checkout');
  });

  it('plan 4792076e Day3 (city-change) — 첫 stop=checkout, 중간=checkin, 마지막=return', () => {
    const stops = [
      { category: 'lodging' }, // Myeongdong (Seoul) — checkout
      { category: 'food' },
      { category: 'lodging' }, // Haeundae (Busan) — checkin
      { category: 'culture' },
      { category: 'attraction' },
      { category: 'food' },
      { category: 'lodging' }, // Haeundae — return
    ];
    expect(computeLodgingRole(stops[0], 0, stops, true)).toBe('checkout');
    expect(computeLodgingRole(stops[2], 2, stops, true)).toBe('checkin');
    expect(computeLodgingRole(stops[6], 6, stops, true)).toBe('return');
    // non-lodging 사이 stops
    expect(computeLodgingRole(stops[1], 1, stops, true)).toBeUndefined();
    expect(computeLodgingRole(stops[3], 3, stops, true)).toBeUndefined();
  });
});
