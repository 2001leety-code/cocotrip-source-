/**
 * 다도시 lodging 도시 폴백 회귀 가드 (2026-06-02, 운영자 신고 plan 4d214e83).
 *
 * 증상: 서울+부산 5일 block_mode plan 의 Day 4·5(city=busan) 의 합성 lodging stop 이
 * 모두 '서울 중구 명동역'(첫 도시 서울!) 이었음. selfHealLodgingBookend 가 trip-level 단일
 * ctx.hotel_address('서울 중구 명동역') 를 첫 도시 판별 없이 전 day 에 적용 → 부산 day 도 서울 숙소.
 *
 * fix: trip-level 단일 ctx 는 첫 도시(days[0].city) day 에만. 다른 도시 day 는 day.city 별
 * CITY_LODGING_DEFAULT(busan→해운대). legacy/단도시 → 전 day 첫 도시 = 회귀 0.
 */
import { describe, it, expect } from 'vitest';
import { selfHealLodgingBookend } from '../../api/_ai_core/planPersister.js';

function cultureStop(name: string, time: string) {
  return { category: 'culture', name, display_name: name, start_time: time, stay_min: 90, order: 1 };
}

describe('selfHealLodgingBookend — 다도시 lodging 도시 폴백 (plan 4d214e83)', () => {
  it('부산 day 의 합성 lodging 은 첫 도시(서울) 호텔이 아니라 부산 zone (지리 파탄 차단)', () => {
    const itinerary: any = {
      days: [
        { day: 1, city: 'seoul', stops: [cultureStop('경복궁', '10:00')] },
        { day: 4, city: 'busan', stops: [cultureStop('감천문화마을', '13:00')] },
      ],
    };
    selfHealLodgingBookend(itinerary, { hotel_address: '서울 중구 명동역', recommendedZone: 'myeongdong', language: 'ko' });

    const seoulLodge = itinerary.days[0].stops.find((s: any) => s.category === 'lodging');
    const busanLodge = itinerary.days[1].stops.find((s: any) => s.category === 'lodging');

    // 서울 day(첫 도시): 사용자 입력 호텔 그대로
    expect(seoulLodge).toBeTruthy();
    expect(seoulLodge.name).toContain('서울');

    // 부산 day(다른 도시): 서울/명동 금지, 부산 zone(해운대)
    expect(busanLodge).toBeTruthy();
    expect(busanLodge.name).not.toContain('서울');
    expect(busanLodge.name).not.toContain('명동');
    expect(busanLodge.name).toContain('해운대');
  });

  it('단도시(전 day seoul) plan 은 기존 동작 — 전 day 사용자 호텔 (회귀 0)', () => {
    const itinerary: any = {
      days: [
        { day: 1, city: 'seoul', stops: [cultureStop('경복궁', '10:00')] },
        { day: 2, city: 'seoul', stops: [{ category: 'food', name: '식당', display_name: '식당', start_time: '12:00', stay_min: 60, order: 1 }] },
      ],
    };
    selfHealLodgingBookend(itinerary, { hotel_address: '서울 중구 명동역', language: 'ko' });
    expect(itinerary.days[0].stops.find((s: any) => s.category === 'lodging').name).toContain('서울');
    expect(itinerary.days[1].stops.find((s: any) => s.category === 'lodging').name).toContain('서울');
  });

  it('legacy plan(day.city 없음) 은 전 day 가 첫 도시 판정 — 사용자 호텔 (회귀 0)', () => {
    const itinerary: any = {
      days: [{ day: 1, stops: [cultureStop('X', '10:00')] }],
    };
    selfHealLodgingBookend(itinerary, { hotel_address: '서울 중구 명동역', language: 'ko' });
    expect(itinerary.days[0].stops.find((s: any) => s.category === 'lodging').name).toContain('서울');
  });

  it('첫 도시가 부산이고 다음이 서울인 역순 다도시도 도시별 폴백', () => {
    const itinerary: any = {
      days: [
        { day: 1, city: 'busan', stops: [cultureStop('해운대해수욕장', '10:00')] },
        { day: 3, city: 'seoul', stops: [cultureStop('경복궁', '10:00')] },
      ],
    };
    // 첫 도시=부산, 사용자 호텔=해운대 주소
    selfHealLodgingBookend(itinerary, { hotel_address: '부산 해운대구 해운대해변로', language: 'ko' });
    const busanLodge = itinerary.days[0].stops.find((s: any) => s.category === 'lodging');
    const seoulLodge = itinerary.days[1].stops.find((s: any) => s.category === 'lodging');
    expect(busanLodge.name).toContain('부산'); // 첫 도시 = 사용자 호텔
    expect(seoulLodge.name).not.toContain('부산'); // 다른 도시(서울) = 서울 zone(명동)
    expect(seoulLodge.name).toContain('명동');
  });
});
