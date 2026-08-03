/**
 * 회귀 잠금 (2026-08-03) — 손님이 공항과 다른 권역에 있을 때 이동 시간을 3배 이상
 * 과소평가하던 것.
 *
 * `estimateAirportTransitMin` 표는 **공항이 속한 권역 안에서의** 이동 시간이다
 * (ICN → 서울권 90분). 운영 실측에서 **부산에 있는 손님이 인천공항에서 출국**하는
 * 플랜이 있었고(직선 346km, 실제 4시간 이상) 그 이동을 90분으로 봤다.
 *
 * #1227 의 출국일 컷이 이 값을 쓰므로 그대로 두면 손님이 비행기를 놓친다.
 * → 도시-공항 직선거리로 권역 밖 여부를 판정해 보정. **보수적으로만 움직인다**
 *   (둘 중 큰 값). 같은 권역이면 값 변화 0.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { applyDepartureDayFlightCap } from '../../api/_ai_core/blockMode.js';

type Stop = Record<string, unknown> & { category?: string; start_time?: string };

const activity = (start: string, stay: number): Stop[] => ([
  { category: 'culture', name: '관광', start_time: start, stay_min: stay },
]);

const airportOf = (stops: Stop[]) => stops.find((s) => s.category === 'travel');

describe('출국 공항이 손님 권역 밖이면 이동 시간을 도시간 이동으로 본다', () => {
  it('운영 재현: 부산 손님 · 인천 출국 — 옛 값(90분)이면 통과할 활동이 잘린다', () => {
    // 비행기 20:00 → 공항 도착 17:00.
    //   옛 코드(이동 90분): 활동 마감 15:30 → 12:00~14:00 은 통과했다.
    //   새 코드(부산→인천 직선 346km): 활동 마감이 크게 앞당겨져 잘린다.
    const stops = activity('12:00', 120);
    const r = applyDepartureDayFlightCap(stops, '20:00', 'ICN_T1', 'ko', 'busan');
    expect(r.trimmed).toBe(1);
  });

  it('같은 조건이라도 서울 손님이면 그대로 유지된다 (권역 안 = 값 변화 0)', () => {
    const stops = activity('12:00', 120);
    const r = applyDepartureDayFlightCap(stops, '20:00', 'ICN_T1', 'ko', 'seoul');
    expect(r.trimmed).toBe(0);
  });

  it('같은 권역 조합은 전부 기존 동작 그대로', () => {
    for (const [city, airport] of [['seoul', 'ICN_T1'], ['seoul', 'GMP'], ['busan', 'PUS'], ['jeju', 'CJU']] as const) {
      // 이른 아침에 끝나는 활동은 어느 조합에서도 살아남는다
      const stops = activity('06:00', 30);
      const r = applyDepartureDayFlightCap(stops, '20:00', airport, 'ko', city);
      expect(r.trimmed, `${city}/${airport}`).toBe(0);
    }
  });

  it('도시를 모르면 기존 동작(공항 권역 기준) — 조용히 낙관적으로 바뀌지 않는다', () => {
    const stops = activity('12:00', 120);
    const r = applyDepartureDayFlightCap(stops, '20:00', 'ICN_T1', 'ko', undefined);
    expect(r.trimmed).toBe(0); // 옛 90분 기준과 동일
  });

  it('모르는 도시 키도 기존 동작으로 떨어진다', () => {
    const stops = activity('12:00', 120);
    const r = applyDepartureDayFlightCap(stops, '20:00', 'ICN_T1', 'ko', 'atlantis');
    expect(r.trimmed).toBe(0);
  });

  it('보수적으로만 움직인다 — 권역 밖이라고 기존 값보다 짧아지지 않는다', () => {
    // 제주 손님 · 제주공항(baseline 25분)에서, 같은 활동이 도시 지정 유무로
    // 더 관대해지는 일은 없어야 한다.
    const withCity = activity('16:00', 60);
    const withoutCity = activity('16:00', 60);
    const a = applyDepartureDayFlightCap(withCity, '20:00', 'CJU', 'ko', 'jeju');
    const b = applyDepartureDayFlightCap(withoutCity, '20:00', 'CJU', 'ko', undefined);
    expect(a.trimmed).toBeGreaterThanOrEqual(b.trimmed);
  });

  it('공항 stop 시각은 도시와 무관하게 출발 − 180분 (도착 마감은 안 바뀐다)', () => {
    for (const city of ['busan', 'seoul', undefined]) {
      const stops = activity('06:00', 30);
      applyDepartureDayFlightCap(stops, '20:00', 'ICN_T1', 'ko', city);
      expect(airportOf(stops)?.start_time, String(city)).toBe('17:00');
    }
  });
});
