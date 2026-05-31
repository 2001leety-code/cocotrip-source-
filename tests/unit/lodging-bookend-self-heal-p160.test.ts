/**
 * P160 (2026-05-22): lodging bookend self-heal.
 *
 * 상용화 D-day prod alert: "Day 3 stops[0].category='food' expected 'lodging' (B-10)".
 * customer path 면 throw 500. 본 fix: stops[0]/stops[-1] 가 lodging 아니면 synthetic 추가.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { selfHealLodgingBookend } from '../../api/_ai_core/planPersister.js';

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
