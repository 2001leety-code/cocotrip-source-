/**
 * 회귀 잠금 (2026-08-03) — 출국일 일정이 항공기 출발 시각을 넘던 것.
 *
 * 운영 실측: departure_time 이 있는 출국일 **7/7 이 비행기 출발 이후에 끝났고,
 * 7/7 에 공항 stop 이 없었다.** 실제 예(비행기 10:00 ICN, 손님은 부산):
 *   [lodging 09:00] [자갈치시장 09:00~10:30] [술고당 10:41~11:41] [lodging 12:41]
 * 비행기가 뜬 뒤에도 밥을 먹고 호텔로 "복귀" 한다.
 *
 * 원인 2가지가 겹쳤다:
 *   1. tail-pop + `stops.length > 2` 하한 — block_mode 는 이 단계에서 숙소 bookend 가
 *      아직 없어 활동 2개뿐인 날이 흔하다 → 루프가 한 번도 안 돈다.
 *   2. `start_time > cap` 비교 — 시작이 cap 이전이어도 끝나는 시각이 넘으면 못 간다.
 * 그리고 공항까지 가는 시간이 아예 빠져 있었다.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { applyDepartureDayFlightCap } from '../../api/_ai_core/blockMode.js';
// @ts-expect-error — JS module
import { AIRPORT_ARRIVE_BEFORE_MIN, AIRPORT_NAMES_KO } from '../../api/_ai_core/constants.js';

type Stop = Record<string, unknown> & { category?: string; start_time?: string; stay_min?: number };

const act = (name: string, start: string, stay: number, category = 'culture'): Stop =>
  ({ category, name, start_time: start, stay_min: stay });

const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

describe('출국일 — 비행기 출발 시각을 넘는 활동은 남지 않는다', () => {
  it('운영 재현: 10:00 ICN 비행기인데 10:30·11:41 까지 관광하던 것이 사라진다', () => {
    const stops: Stop[] = [
      act('자갈치시장', '09:00', 90),
      act('술고당', '10:41', 60, 'food'),
    ];
    const r = applyDepartureDayFlightCap(stops, '10:00', 'ICN_T1', 'ko');
    expect(r.trimmed).toBe(2);
    // 활동은 0개, 공항 stop 만 남는다
    expect(stops.filter((s) => s.category !== 'travel')).toHaveLength(0);
    expect(r.airportStopAdded).toBe(true);
  });

  it('활동이 2개뿐이어도 잘린다 (옛 코드의 stops.length > 2 하한이 막던 것)', () => {
    const stops: Stop[] = [act('a', '09:00', 60), act('b', '11:00', 60)];
    applyDepartureDayFlightCap(stops, '10:00', 'CJU', 'ko');
    expect(stops.some((s) => s.category === 'culture')).toBe(false);
  });

  it('시작은 cap 이전이어도 종료가 넘으면 자른다 (옛 코드는 start 만 봤다)', () => {
    // 비행기 20:00 → 공항 도착 17:00, 제주공항 이동 25분 → 활동 종료 마감 16:35
    const stops: Stop[] = [act('오래 머무는 곳', '16:00', 120)]; // 16:00~18:00
    const r = applyDepartureDayFlightCap(stops, '20:00', 'CJU', 'ko');
    expect(r.trimmed).toBe(1);
  });

  it('늦은 비행기면 활동을 남긴다 (전부 지우지 않는다)', () => {
    const stops: Stop[] = [
      act('오전 관광', '09:00', 120),   // ~11:00
      act('점심', '11:30', 60, 'food'), // ~12:30
      act('오후 관광', '13:00', 90),    // ~14:30
    ];
    const r = applyDepartureDayFlightCap(stops, '21:00', 'CJU', 'ko');
    // 공항 도착 18:00, 이동 25분 → 마감 17:35. 셋 다 그 전에 끝난다.
    expect(r.trimmed).toBe(0);
    expect(stops.filter((s) => s.category !== 'travel')).toHaveLength(3);
  });

  it('숙소·공항·이동 stop 은 보호한다', () => {
    const stops: Stop[] = [
      { category: 'lodging', name: '호텔', start_time: '09:00', stay_min: 0 },
      act('관광', '09:00', 120),
      { category: 'lodging', name: '호텔 복귀', start_time: '12:00', stay_min: 0 },
    ];
    applyDepartureDayFlightCap(stops, '10:00', 'ICN_T1', 'ko');
    expect(stops.filter((s) => s.category === 'lodging')).toHaveLength(2);
    expect(stops.some((s) => s.category === 'culture')).toBe(false);
  });
});

describe('출국일 — 공항 stop 이 실제로 들어간다', () => {
  it('공항 도착 시각 = 출발 − AIRPORT_ARRIVE_BEFORE_MIN', () => {
    const stops: Stop[] = [act('관광', '09:00', 60)];
    applyDepartureDayFlightCap(stops, '20:00', 'CJU', 'ko');
    const airport = stops.find((s) => s.category === 'travel');
    expect(airport).toBeTruthy();
    expect(toMin(String(airport!.start_time))).toBe(toMin('20:00') - AIRPORT_ARRIVE_BEFORE_MIN);
  });

  it('이름은 한글(지도 API 키) · 주소·좌표가 붙는다', () => {
    const stops: Stop[] = [];
    applyDepartureDayFlightCap(stops, '18:00', 'ICN_T1', 'ko');
    const a = stops.find((s) => s.category === 'travel') as Record<string, unknown>;
    expect(a.name).toBe(AIRPORT_NAMES_KO.ICN_T1);
    expect(String(a.name)).toMatch(/[가-힣]/);
    expect(String(a.address)).toContain('인천');
    expect(Number(a.lat)).toBeGreaterThan(0);
    expect(Number(a.lng)).toBeGreaterThan(0);
    expect(a.stay_min).toBe(0);
  });

  it('안내 문구가 손님 언어로 나간다', () => {
    for (const [lang, needle] of [['ko', '공항'], ['en', 'airport'], ['ja', '空港'], ['zh', '机场']] as const) {
      const stops: Stop[] = [];
      applyDepartureDayFlightCap(stops, '18:00', 'CJU', lang);
      expect(String(stops[0].tip), lang).toContain(needle);
    }
  });

  it('이미 공항 stop 이 있으면 새로 넣지 않는다 (legacy/Gemini 산출 존중)', () => {
    const stops: Stop[] = [
      { category: 'travel', name: '제주국제공항', start_time: '15:00', stay_min: 0 },
    ];
    const r = applyDepartureDayFlightCap(stops, '18:00', 'CJU', 'ko');
    expect(r.airportStopAdded).toBe(false);
    expect(stops).toHaveLength(1);
  });
});

describe('출국일 — 정보가 없으면 아무것도 하지 않는다 (graceful)', () => {
  it('departure_time 미입력이면 건드리지 않는다', () => {
    const stops: Stop[] = [act('늦은 관광', '22:00', 60)];
    const r = applyDepartureDayFlightCap(stops, '', 'ICN_T1', 'ko');
    expect(r.trimmed).toBe(0);
    expect(r.airportStopAdded).toBe(false);
    expect(stops).toHaveLength(1);
  });

  it('공항 코드를 모르면 컷은 하되 공항 stop 은 안 만든다', () => {
    const stops: Stop[] = [act('관광', '09:00', 120)];
    const r = applyDepartureDayFlightCap(stops, '10:00', 'ALREADY_IN_KOREA', 'ko');
    expect(r.trimmed).toBe(1);
    expect(r.airportStopAdded).toBe(false);
  });

  it('시각을 모르는 stop 은 건드리지 않는다', () => {
    const stops: Stop[] = [{ category: 'culture', name: '시각 없음' }];
    const r = applyDepartureDayFlightCap(stops, '10:00', 'CJU', 'ko');
    expect(r.trimmed).toBe(0);
  });
});

describe('임계값은 단일 원천이다', () => {
  it('blockMode 가 180 을 다시 적지 않는다', () => {
    expect(AIRPORT_ARRIVE_BEFORE_MIN).toBe(180);
  });
});
