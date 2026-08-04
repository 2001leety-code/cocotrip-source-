/**
 * P160 (2026-05-22): lodging bookend self-heal.
 *
 * 상용화 D-day prod alert: "Day 3 stops[0].category='food' expected 'lodging' (B-10)".
 * customer path 면 throw 500. 본 fix: stops[0]/stops[-1] 가 lodging 아니면 synthetic 추가.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { selfHealLodgingBookend } from '../../api/_ai_core/planPersister.js';
// @ts-expect-error — JS module
import { applyDepartureDayFlightCap } from '../../api/_ai_core/blockMode.js';

describe('P160 selfHealLodgingBookend', () => {
  it('첫 stop = food → synthetic lodging prepend', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Busan',
          stops: [
            { category: 'food', name: '광장시장', start_time: '12:00', order: 1 },
            { category: 'attraction', name: '경복궁', start_time: '14:00', order: 2 },
            { category: 'lodging', name: '명동 호텔', start_time: '20:00', order: 3 },
          ],
        },
      ],
    } as any;

    const healed = selfHealLodgingBookend(itinerary);

    expect(healed).toHaveLength(1);
    expect(healed[0].kind).toBe('prepend_first_lodging');
    expect(itinerary.days[0].stops[0].category).toBe('lodging');
    expect(itinerary.days[0].stops[0].name).toContain('해운대'); // Busan default
    expect(itinerary.days[0].stops[0]._self_healed).toBe(true);
    expect(itinerary.days[0].stops).toHaveLength(4);
    expect(itinerary.quality_warnings).toHaveLength(1);
    expect(itinerary.quality_warnings[0].kind).toBe('lodging_bookend_self_healed');
  });

  it('마지막 stop = food → synthetic lodging append', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '명동 호텔', start_time: '09:00', order: 1 },
            { category: 'attraction', name: '경복궁', start_time: '11:00', order: 2 },
            { category: 'food', name: '광장시장', start_time: '18:00', order: 3 },
          ],
        },
      ],
    } as any;

    const healed = selfHealLodgingBookend(itinerary);

    expect(healed).toHaveLength(1);
    expect(healed[0].kind).toBe('append_last_lodging');
    const stops = itinerary.days[0].stops;
    expect(stops[stops.length - 1].category).toBe('lodging');
    expect(stops[stops.length - 1].name).toContain('명동'); // Seoul default
  });

  it('마지막 stop = travel/airport 는 OK (출국일)', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '명동 호텔', start_time: '09:00' },
            { category: 'food', name: '광장시장', start_time: '12:00' },
            { category: 'travel', name: '인천공항 T1', start_time: '15:00' },
          ],
        },
      ],
    } as any;

    const healed = selfHealLodgingBookend(itinerary);
    expect(healed).toHaveLength(0); // travel 은 OK
  });

  it('day.lodging 정보 있으면 그대로 사용', () => {
    const itinerary = {
      days: [
        {
          day: 2,
          city: 'Busan',
          lodging: { name: '해운대 그랜드 호텔', address: '부산광역시 해운대구 마린시티로 12' },
          stops: [
            { category: 'food', name: '광안리 회센터', start_time: '12:00' },
            { category: 'lodging', name: '해운대 그랜드 호텔', start_time: '20:00' },
          ],
        },
      ],
    } as any;

    selfHealLodgingBookend(itinerary);
    expect(itinerary.days[0].stops[0].name).toBe('해운대 그랜드 호텔');
    expect(itinerary.days[0].stops[0].address).toContain('해운대구');
  });

  it('정상 bookend (lodging-...-lodging) 은 변경 없음', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '명동 호텔 출발', start_time: '09:00' },
            { category: 'attraction', name: '경복궁', start_time: '11:00' },
            { category: 'lodging', name: '명동 호텔 복귀', start_time: '20:00' },
          ],
        },
      ],
    } as any;

    const healed = selfHealLodgingBookend(itinerary);
    expect(healed).toHaveLength(0);
    expect(itinerary.days[0].stops).toHaveLength(3);
    expect(itinerary.quality_warnings).toBeUndefined();
  });

  it('빈 stops Day 는 skip', () => {
    const itinerary = { days: [{ day: 1, city: 'Seoul', stops: [] }] } as any;
    expect(selfHealLodgingBookend(itinerary)).toHaveLength(0);
  });

  it('synthetic stop start_time = 첫 stop 1시간 전 (09:00 floor)', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [
            { category: 'food', name: '광장시장', start_time: '14:00' },
            { category: 'lodging', name: '명동 호텔', start_time: '20:00' },
          ],
        },
      ],
    } as any;
    selfHealLodgingBookend(itinerary);
    // 14:00 - 60min = 13:00
    expect(itinerary.days[0].stops[0].start_time).toBe('13:00');
  });

  it('first stop 09:00 이전이면 09:00 floor', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [
            { category: 'food', name: '카페', start_time: '09:30' },
            { category: 'lodging', name: '호텔', start_time: '20:00' },
          ],
        },
      ],
    } as any;
    selfHealLodgingBookend(itinerary);
    // 09:30 - 60min = 08:30 → floor to 09:00
    expect(itinerary.days[0].stops[0].start_time).toBe('09:00');
  });

  it('도시 누락 시 generic placeholder', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          stops: [
            { category: 'food', name: '아침', start_time: '09:00' },
            { category: 'lodging', name: '호텔', start_time: '20:00' },
          ],
        },
      ],
    } as any;
    const healed = selfHealLodgingBookend(itinerary);
    expect(healed).toHaveLength(1);
    expect(itinerary.days[0].stops[0].name).toContain('숙소'); // P-launch: 호텔(위치 미정)→지역 숙소
  });
});

/**
 * 회귀 잠금 (2026-08-03) — 합성 숙소 출발 시각이 이동 시간을 무시하던 것.
 *
 * 옛 규칙 "첫 stop − 60분, 09:00 바닥" 은 이동 시간을 안 봤다. block_mode 는 day
 * 시작이 기본 09:00 이라 −60 이 바닥에 걸려 **출발 시각이 첫 활동과 같아졌다**.
 * 운영 실측: block_mode day-start 49건 중 38건이 여유 부족(중앙 −18분, 최악 −96분).
 * 손님은 "숙소 09:00 출발 → 서울숲 09:00 도착(이동 30분)" 을 받았다.
 * 수정 후 같은 49건 전부 여유 정확히 +5(다른 모든 구간 291개와 같은 불변식).
 *
 * ⚠️ tour_start_time 은 "첫 활동 시작" 이지 "숙소 출발" 이 아니다
 *    (buildPrompt.js:401-402 · responseValidator 는 lodging 을 검사에서 제외).
 *    그래서 활동 시각은 그대로 두고 표시용 출발 시각만 고친다.
 */
describe('합성 숙소 출발 시각은 실제 이동 시간을 반영한다', () => {
  type Stop = Record<string, unknown> & { start_time?: string };
  type Day = { day: number; city: string; stops: Stop[]; lodging_to_first?: { est_min: number } };

  const dayWithFirstStop = (first: Stop): { days: Day[] } => ({
    days: [
      {
        day: 2,
        city: 'Seoul',
        stops: [first, { category: 'lodging', name: '명동 지역 숙소', start_time: '21:00' }],
      },
    ],
  });

  const departure = (itinerary: { days: Day[] }) => String(itinerary.days[0].stops[0].start_time);
  const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

  it('운영 재현: 09:00 첫 활동 + 이동 30분 → 출발이 09:00 이 아니다', () => {
    const itinerary = dayWithFirstStop({
      category: 'nature', name: '서울숲', start_time: '09:00', stay_min: 55,
      transit_from_prev: { est_min: 30 },
    });
    selfHealLodgingBookend(itinerary);
    // 09:00 − 이동 30분 − 버퍼 5분 = 08:25
    expect(departure(itinerary)).toBe('08:25');
  });

  it('실측 이동(ODsay/TMAP)이 Gemini 추정보다 우선한다', () => {
    const itinerary = dayWithFirstStop({
      category: 'culture', name: '경복궁', start_time: '10:00', stay_min: 90,
      transit_from_prev: { est_min: 14 },
      travelFromPrev: { transitOptions: { publicTransit: { duration: 40 } } },
    });
    selfHealLodgingBookend(itinerary);
    // 실측 40분 사용 → 10:00 − 40 − 5 = 09:15 (추정 14분이었다면 09:41)
    expect(departure(itinerary)).toBe('09:15');
  });

  it('day 레벨 lodging_to_first 도 쓴다', () => {
    const itinerary = dayWithFirstStop({
      category: 'culture', name: '한옥마을', start_time: '09:30', stay_min: 60,
    });
    itinerary.days[0].lodging_to_first = { est_min: 20 };
    selfHealLodgingBookend(itinerary);
    expect(departure(itinerary)).toBe('09:05');
  });

  it('이동 시간을 모르면 옛 규칙(−60분·09:00 바닥)을 그대로 쓴다', () => {
    const itinerary = dayWithFirstStop({
      category: 'food', name: '카페', start_time: '09:30',
    });
    selfHealLodgingBookend(itinerary);
    expect(departure(itinerary)).toBe('09:00');
  });

  it('이동 시간 null 은 "모름" 으로 본다 (Number(null)===0 함정)', () => {
    const itinerary = dayWithFirstStop({
      category: 'food', name: '카페', start_time: '14:00',
      transit_from_prev: { est_min: null },
    });
    selfHealLodgingBookend(itinerary);
    expect(departure(itinerary)).toBe('13:00'); // 옛 규칙 폴백
  });

  it('새벽 출발 하한(05:00)은 이동이 들어갈 자리가 남을 때만 쓴다', () => {
    // 하한을 쓸 수 있는 경우: 07:30 첫 활동 + 이동 25분 → 07:00 이지만 하한 위라 그대로.
    const ok = dayWithFirstStop({
      category: 'culture', name: '이른 관람', start_time: '05:20', stay_min: 30,
      transit_from_prev: { est_min: 10 },
    });
    selfHealLodgingBookend(ok);
    expect(departure(ok)).toBe('05:05'); // 05:20 − 10 − 5, 하한 위

    // 🔴 하한을 쓰면 못 가는 경우: 06:00 기차 + 이동 120분.
    //   옛 코드는 05:00 을 적었다 — 05:00 에 나서면 07:00 도착이라 기차를 놓친다.
    //   "하한이 첫 stop 보다 이르기만 하면 OK" 라는 옛 조건이 이걸 못 걸렀다.
    const miss = dayWithFirstStop({
      category: 'travel', name: '첫 기차', start_time: '06:00', stay_min: 30,
      transit_from_prev: { est_min: 120 },
    });
    selfHealLodgingBookend(miss);
    expect(departure(miss)).toBe('03:55'); // 06:00 − 120 − 5. 이르지만 이게 사실이다
    expect(toMin(departure(miss)) + 120).toBeLessThanOrEqual(toMin('06:00'));
  });

  it('05:00 하한이 다시 "출발 = 도착" 충돌을 만들면 적용하지 않는다', () => {
    const itinerary = dayWithFirstStop({
      category: 'travel', name: '새벽 공항버스', start_time: '04:30', stay_min: 0,
      transit_from_prev: { est_min: 25 },
    });
    selfHealLodgingBookend(itinerary);
    // 하한(05:00)이 첫 활동(04:30)보다 늦으므로 적용 X → 04:00 유지
    expect(departure(itinerary)).toBe('04:00');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 출국일 — 운영 plan a159c200 (2026-08-04 스모크) 재현.
  //   손님에게 나간 마지막 날: [lodging 09:00 해운대 지역 숙소] → [travel 07:00 인천공항]
  //   숙소를 09:00 에 나서는데 공항 도착이 07:00. 시각이 2시간 거꾸로 간다.
  //   원인 두 겹: ① blockMode 가 이미 계산한 공항 이동 추정을 stop 에 안 남겨
  //   "이동 미상" 으로 떨어지고 ② 그 분기의 09:00 바닥이 무조건 적용됐다.
  // ───────────────────────────────────────────────────────────────────────────
  describe('출국일 체크아웃 시각', () => {
    const departureDay = (airportStop: Stop) => ({
      days: [{ day: 5, city: 'busan', stops: [airportStop] as Stop[] }],
    });

    it('blockMode 가 공항 이동 추정을 stop 에 남긴다', () => {
      const stops: Stop[] = [];
      const r = applyDepartureDayFlightCap(stops, '10:00', 'ICN_T1', 'ko', 'busan');
      expect(r.airportStopAdded).toBe(true);
      expect(stops[0].start_time).toBe('07:00'); // 10:00 − 180분
      // 부산에서 인천공항은 공항 표값(90분)이 아니라 거리 보정값이어야 한다(#1228).
      expect(Number(stops[0]._airport_transit_est_min)).toBeGreaterThan(180);
    });

    it('운영 재현: 숙소 출발이 공항 도착보다 늦지 않다', () => {
      const stops: Stop[] = [];
      applyDepartureDayFlightCap(stops, '10:00', 'ICN_T1', 'ko', 'busan');
      const transit = Number(stops[0]._airport_transit_est_min);
      const itinerary = departureDay(stops[0]);
      selfHealLodgingBookend(itinerary);

      const lodging = String(itinerary.days[0].stops[0].start_time);
      expect(lodging).not.toBe('09:00');                       // 옛 결과
      expect(toMin(lodging)).toBeLessThan(toMin('07:00'));     // 역행 없음
      // 이동 시간이 실제로 들어간다 — 그래야 비행기를 탄다.
      expect(toMin(lodging) + transit + 5).toBeLessThanOrEqual(toMin('07:00'));
    });

    it('추정값이 없어도 역행하지 않는다 (2차 방어)', () => {
      const itinerary = departureDay({
        category: 'travel', name: '인천국제공항 T1', start_time: '07:00', stay_min: 0,
      });
      selfHealLodgingBookend(itinerary);
      const lodging = String(itinerary.days[0].stops[0].start_time);
      expect(lodging).toBe('06:00');                            // 07:00 − 60, 09:00 바닥 미적용
      expect(toMin(lodging)).toBeLessThan(toMin('07:00'));
    });
  });

  it('출발이 첫 활동보다 늦거나 같아지는 일은 없다', () => {
    const cases: Array<[string, number]> = [
      ['09:00', 30], ['09:00', 5], ['10:00', 96], ['06:00', 120], ['04:30', 25],
    ];
    for (const [start, transit] of cases) {
      const itinerary = dayWithFirstStop({
        category: 'culture', name: 'x', start_time: start, transit_from_prev: { est_min: transit },
      });
      selfHealLodgingBookend(itinerary);
      expect(
        toMin(departure(itinerary)),
        `${start} / 이동 ${transit}분`,
      ).toBeLessThan(toMin(start));
    }
  });
});
