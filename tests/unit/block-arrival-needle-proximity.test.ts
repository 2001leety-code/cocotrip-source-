/**
 * #arrival-needle (운영자 신고) — 밤도착 시 도착일에 숙소에서 먼 큐레이션 첫 stop 이
 *   짧은 저녁 window 에 들어가 호텔→먼stop→호텔 왕복 needle 패턴(예: 명동 호텔 ↔ 조계사 1.2km
 *   대신 강남 8km 가 박힘)을 만든다. expandBlocksToItinerary 가 도착일에 한해 관광 stop 을
 *   숙소 근접순으로 재정렬해 가장 가까운 stop 이 살아남게 한다.
 *
 *   검증: reorderArrivalStopsByLodgingProximity 직접 호출(순수 함수) + expandBlocksToItinerary
 *   end-to-end(짧은 저녁 window 로 cutoff → 가까운 stop 생존). 메모리 lesson "동작 테스트".
 *
 *   ⚠️ 보수: 좌표 없으면 무변 / 도착일 외 day 무변 / 도착이 시작을 안 밀면 무변.
 */
import { describe, it, expect } from 'vitest';

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : -1;
};

// 좌표: 명동 호텔(숙소) / 조계사(가까움 ~1.2km) / 강남역(멀음 ~8km).
const MYEONGDONG: [number, number] = [37.5636, 126.9826];
const JOGYESA: [number, number] = [37.5747, 126.9817];   // 가까움
const GANGNAM: [number, number] = [37.4979, 127.0276];   // 멀음

/**
 * 합성 블록: stop1=호텔(lodging), stop2=먼 관광(offset0), stop3=가까운 관광(offset60).
 *   withCoords=false 면 관광 stop 에 좌표 미부여(안전 가드 검증용).
 */
function makeBlocks(withCoords: boolean) {
  return [
    {
      id: 'T1',
      city: 'seoul',
      zone: 'Test',
      theme: 'Test theme',
      intensity: 'standard',
      stops: [
        {
          order: 1,
          name: 'Myeongdong Hotel',
          category: 'lodging',
          start_time_offset_min: 0,
          stay_min: 30,
          ...(withCoords ? { lat: MYEONGDONG[0], lng: MYEONGDONG[1] } : {}),
        },
        {
          order: 2,
          name: 'Gangnam Far', // 큐레이션 첫 관광 = 멀다 (needle 유발)
          category: 'culture',
          start_time_offset_min: 0,
          stay_min: 60,
          ...(withCoords ? { lat: GANGNAM[0], lng: GANGNAM[1] } : {}),
        },
        {
          order: 3,
          name: 'Jogyesa Near', // 숙소 근처 — 짧은 저녁엔 이게 들어가야 함
          category: 'culture',
          start_time_offset_min: 60,
          stay_min: 60,
          ...(withCoords ? { lat: JOGYESA[0], lng: JOGYESA[1] } : {}),
        },
      ],
    },
  ];
}

const baseSelections = {
  day_selections: [{ day: 1, block_id: 'T1', tweak_notes: '' }],
  language: 'en',
};
const baseInput = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15' };

// ICN 18:00 도착 → ready = 18:00 + 90(입국) + 90(인천이동) = 21:00. tour_end 21:30 →
//   dayStart=21:00 (짧은 저녁 window), 관광 슬롯 21:00 / 22:00 → 22:00 은 cutoff 로 trim.
const lateArrivalInput = {
  ...baseInput,
  arrival_time: '18:00',
  arrival_airport: 'ICN',
  tour_start_time: '09:00',
  tour_end_time: '21:30',
};

// ────────────────────────────────────────────────────────────────────────────
// 1. 순수 함수 reorderArrivalStopsByLodgingProximity — 단위 검증
// ────────────────────────────────────────────────────────────────────────────
describe('reorderArrivalStopsByLodgingProximity — 도착일 숙소 근접 재정렬', () => {
  it('enabled + 좌표 → 관광 stop 을 숙소 근접순으로 재배치 (가까운 stop 이 이른 슬롯)', async () => {
    const { reorderArrivalStopsByLodgingProximity } = await import('../../api/_ai_core/blockMode.js');
    const stops = makeBlocks(true)[0].stops;
    const out = reorderArrivalStopsByLodgingProximity(stops, { enabled: true });
    // 슬롯 0(offset 0, 호텔 다음)에는 가까운 Jogyesa, 슬롯 1(offset 60)에는 먼 Gangnam.
    const sights = out.filter((s: any) => s.category === 'culture');
    const slot0 = sights.find((s: any) => s.start_time_offset_min === 0);
    const slot60 = sights.find((s: any) => s.start_time_offset_min === 60);
    expect(slot0.name, '이른 슬롯(offset 0)에 가까운 Jogyesa').toBe('Jogyesa Near');
    expect(slot60.name, '늦은 슬롯(offset 60)에 먼 Gangnam').toBe('Gangnam Far');
    // 호텔(lodging)은 위치·offset 불변.
    expect(out[0].category).toBe('lodging');
    expect(out[0].start_time_offset_min).toBe(0);
  });

  it('enabled=false → 원본 그대로 (도착일 외 day 무변)', async () => {
    const { reorderArrivalStopsByLodgingProximity } = await import('../../api/_ai_core/blockMode.js');
    const stops = makeBlocks(true)[0].stops;
    const out = reorderArrivalStopsByLodgingProximity(stops, { enabled: false });
    expect(out).toBe(stops); // 동일 참조 = no-op
  });

  it('좌표 없음 → 원본 그대로 (안전 가드)', async () => {
    const { reorderArrivalStopsByLodgingProximity } = await import('../../api/_ai_core/blockMode.js');
    const stops = makeBlocks(false)[0].stops;
    const out = reorderArrivalStopsByLodgingProximity(stops, { enabled: true });
    expect(out).toBe(stops); // 좌표 없으면 무변
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. end-to-end expandBlocksToItinerary — 짧은 저녁 window 에 가까운 stop 생존
// ────────────────────────────────────────────────────────────────────────────
describe('#arrival-needle end-to-end — 밤도착 도착일에 가까운 stop 선택', () => {
  it('[먼stop, 가까운stop] + 짧은 저녁 → 살아남는 관광 stop = 가까운 Jogyesa', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks(true), lateArrivalInput);
    const stops = itin.days[0].stops;
    const sights = stops.filter(
      (s: any) => s.category !== 'lodging' && s.category !== 'airport' && s.category !== 'travel'
    );
    // 짧은 window(21:00~21:30) 에 관광 1개만 생존 — 그게 가까운 Jogyesa 여야 함.
    expect(sights.length, '관광 stop 1개만 생존(22:00 trim)').toBe(1);
    expect(sights[0].name, '생존 관광 = 숙소 근처 Jogyesa (먼 Gangnam 아님)').toBe('Jogyesa Near');
    expect(sights.every((s: any) => toMin(s.start_time) <= toMin('21:30')), '생존 stop 이 종료 cap 이내').toBe(true);
  });

  it('좌표 없으면 재정렬 무변 → 큐레이션 첫 관광(먼 Gangnam)이 그대로 생존 (회귀 가드)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks(false), lateArrivalInput);
    const sights = itin.days[0].stops.filter(
      (s: any) => s.category !== 'lodging' && s.category !== 'airport' && s.category !== 'travel'
    );
    expect(sights.length).toBe(1);
    expect(sights[0].name, '좌표 없으면 원본 순서 유지').toBe('Gangnam Far');
  });

  it('도착 없음(낮 시작, arrivalLateStart=false) → 재정렬 안 함, 큐레이션 순서 유지', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    // arrival_time 없음 → dayStart=09:00, 짧은 window 아님. 둘 다 종료 전이라 둘 다 생존.
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks(true), {
      ...baseInput,
      arrival_time: '',
      tour_start_time: '09:00',
      tour_end_time: '21:00',
    });
    const sights = itin.days[0].stops.filter((s: any) => s.category === 'culture');
    // 큐레이션 순서: 첫 관광 = Gangnam (offset 0 → 09:00), 둘째 = Jogyesa (offset 60 → 10:00).
    expect(sights[0].name, '도착 미입력 → 큐레이션 순서 그대로(첫 관광=Gangnam)').toBe('Gangnam Far');
    expect(sights.length).toBe(2);
  });
});
