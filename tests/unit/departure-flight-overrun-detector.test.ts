/**
 * #1237 후속 (2026-08-04): 출국일 항공 마감 초과를 **보는 눈**이 없었다.
 *
 * 운영 legacy plan `358e84c9` 는 10:00 ICN 출발에 공항 도착 09:31(= 비행기를 놓친다)인데
 * 품질점수 **79점**이었다. 지표 9개 중 출발 시각을 보는 게 하나도 없어서, 이 결함은
 * 운영 Firestore 를 손으로 떠서야 발견됐다. #1237 이 생성 쪽을 막았지만 컷이 또
 * 배선에서 빠지거나 조용히 skip 되면 다시 안 보인다 — 그래서 감시를 따로 둔다.
 *
 * 잠금 세 겹: 탐지 로직 / 경고·알림 / persistPlan 배선.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const telegramCalls: Array<Record<string, unknown>> = [];
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: (payload: Record<string, unknown>) => {
    telegramCalls.push(payload);
    return Promise.resolve();
  },
}));

import { detectDepartureFlightOverrun } from '../../api/_ai_core/qualityMetrics.js';
import { runDepartureOverrunCheck } from '../../api/_ai_core/planPersister.js';
import { applyDepartureDayFlightCap } from '../../api/_ai_core/blockMode.js';

type Stop = { order?: number; category: string; name: string; start_time: string; end_time?: string; stay_min?: number };
type Itin = { days: Array<{ day: number; city?: string; stops: Stop[] }>; quality_warnings?: Array<Record<string, unknown>> };

/** 운영 legacy plan 358e84c9 — 10:00 ICN 출발인데 공항 도착 09:31. */
const missedFlightPlan = (): Itin => ({
  days: [
    { day: 1, stops: [{ category: 'lodging', name: '롯데호텔 서울', start_time: '15:00' }] },
    {
      day: 2,
      stops: [
        { category: 'lodging', name: '롯데호텔 서울', start_time: '06:30' },
        { category: 'airport', name: '인천국제공항 T1', start_time: '09:31' },
      ],
    },
  ],
});

beforeEach(() => { telegramCalls.length = 0; });

describe('detectDepartureFlightOverrun — 출국일 마감 초과 탐지', () => {
  it('운영 358e84c9 를 잡는다 (09:31 > 10:00 − 3시간)', () => {
    const hits = detectDepartureFlightOverrun(missedFlightPlan(), '10:00');
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('인천국제공항 T1');
    expect(hits[0].start_time).toBe('09:31');
    expect(hits[0].day).toBe(2);
  });

  it('#1231 모양(숙소 09:00 → 공항 07:00)도 숙소를 잡는다', () => {
    const itin: Itin = {
      days: [{
        day: 5,
        stops: [
          { category: 'lodging', name: '해운대 지역 숙소', start_time: '09:00' },
          { category: 'travel', name: '인천국제공항 T1', start_time: '07:00' },
        ],
      }],
    };
    const hits = detectDepartureFlightOverrun(itin, '10:00');
    expect(hits.map((h) => h.category)).toEqual(['lodging']);
  });

  it('정상 출국일은 0건 (공항 도착 = 마감 시각 정각도 통과)', () => {
    const itin: Itin = {
      days: [{
        day: 3,
        stops: [
          { category: 'lodging', name: 'X', start_time: '02:20' },
          { category: 'travel', name: '인천국제공항 T1', start_time: '07:00' },
        ],
      }],
    };
    expect(detectDepartureFlightOverrun(itin, '10:00')).toHaveLength(0);
  });

  it('출발 시각 미입력이면 판정하지 않는다', () => {
    expect(detectDepartureFlightOverrun(missedFlightPlan(), '')).toHaveLength(0);
    expect(detectDepartureFlightOverrun(missedFlightPlan(), undefined as unknown as string)).toHaveLength(0);
  });

  it('심야 출발(마감이 전날로 넘어감)은 오탐 내지 않는다', () => {
    // 01:00 출발 → 마감 = −120분. 그날 모든 stop 이 "초과"로 보이는 오탐 방지.
    expect(detectDepartureFlightOverrun(missedFlightPlan(), '01:00')).toHaveLength(0);
  });

  it('마지막 day 만 본다 — 중간 day 의 늦은 stop 은 무관', () => {
    const itin = missedFlightPlan();
    itin.days[0].stops.push({ category: 'food', name: '저녁', start_time: '20:00' });
    itin.days[1].stops[1].start_time = '07:00';   // 출국일은 정상으로
    expect(detectDepartureFlightOverrun(itin, '10:00')).toHaveLength(0);
  });

  it('#1237 컷을 통과한 뒤에는 0건 (고치는 쪽과 보는 쪽이 같은 기준)', () => {
    const itin = missedFlightPlan();
    applyDepartureDayFlightCap(itin.days[1].stops, '10:00', 'ICN_T1', 'ko', 'seoul');
    expect(detectDepartureFlightOverrun(itin, '10:00')).toHaveLength(0);
  });
});

describe('runDepartureOverrunCheck — 경고 + 알림', () => {
  it('초과 시 quality_warning 박제 + 운영자 알림', () => {
    const itin = missedFlightPlan();
    const n = runDepartureOverrunCheck(itin, {
      body: { departureTime: '10:00', orderId: 'PAYPAL-REAL-1' },
      departure_airport: 'ICN_T1',
    });

    expect(n).toBe(1);
    const w = (itin.quality_warnings || []).find((x) => x.kind === 'departure_flight_overrun');
    expect(w).toBeTruthy();
    expect(w?.type).toBe('departure_flight_overrun');   // P161: kind/type 둘 다 필요
    expect(w?.severity).toBe('high');
    expect(String(w?.message)).toContain('09:31');

    expect(telegramCalls).toHaveLength(1);
    expect(telegramCalls[0].severity).toBe('high');     // 손님 결제 = high
  });

  it('운영자 테스트(TEST-/ADMIN-BYPASS-)는 알림 severity 를 낮춘다', () => {
    runDepartureOverrunCheck(missedFlightPlan(), {
      body: { departureTime: '10:00', orderId: 'ADMIN-BYPASS-123' },
      departure_airport: 'ICN_T1',
    });
    expect(telegramCalls[0].severity).toBe('low');
  });

  it("raw body 가 'HH:mm:ss' / snake_case 로 와도 감시가 조용히 꺼지지 않는다", () => {
    const n = runDepartureOverrunCheck(missedFlightPlan(), {
      body: { departure_time: '10:00:00' },
      departure_airport: 'ICN_T1',
    });
    expect(n).toBe(1);
  });

  it('정상 플랜이면 경고도 알림도 없다', () => {
    const itin = missedFlightPlan();
    itin.days[1].stops[1].start_time = '07:00';
    const n = runDepartureOverrunCheck(itin, { body: { departureTime: '10:00' } });
    expect(n).toBe(0);
    expect(itin.quality_warnings).toBeUndefined();
    expect(telegramCalls).toHaveLength(0);
  });

  it('감시가 plan 저장을 막지 않는다 (throw 대신 0)', () => {
    expect(runDepartureOverrunCheck(null as unknown as Itin, { body: { departureTime: '10:00' } })).toBe(0);
    expect(runDepartureOverrunCheck(undefined as unknown as Itin, undefined)).toBe(0);
  });
});

describe('배선 — persistPlan 이 감시를 실제로 부른다', () => {
  it('persistPlan 안에서 runDepartureOverrunCheck 호출', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('api/_ai_core/planPersister.js', 'utf8');
    const persistBody = src.slice(src.indexOf('export async function persistPlan'));
    // 함수가 정의만 되고 안 불리면 #1237 과 같은 "있는데 안 걸리는" 상태가 된다.
    expect(persistBody).toMatch(/runDepartureOverrunCheck\(\s*itinerary\s*,/);
  });
});
