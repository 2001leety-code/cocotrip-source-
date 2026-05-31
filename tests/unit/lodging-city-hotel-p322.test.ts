/**
 * P322 (2026-05-31): block_mode 다도시 lodging name 도시 일치.
 *
 * 버그 (prod plan b3ade000 Day4-5): backfillDayLodging 이 부산 day 를
 *   { name: null, address: 부산호텔 } 로 채움 → selfHealLodgingBookend 의
 *   synName = day.lodging.name(null) || ctx.hotel_address(전역 첫도시=서울호텔)
 *   → 부산 day lodging stop 이 name="명동 신라스테이"(서울) + address="해운대 시그니엘"(부산)
 *   자가모순. (block_mode 만 발현 — legacy 는 day.lodging 존재로 backfill skip)
 *
 * fix: backfillDayLodging 이 name 도 도시 호텔로 → selfHeal 이 도시 호텔명 보존.
 *
 * 회귀 시: 다도시 block_mode plan 의 둘째 도시 이후 day lodging 에 첫 도시 호텔명 박힘
 *         (손님 혼란 — 부산 일정인데 서울 호텔 이름).
 */
import { describe, it, expect } from 'vitest';
import {
  backfillDayLodging,
  selfHealLodgingBookend,
} from '../../api/_ai_core/planPersister.js';

describe('[P322] block_mode 다도시 lodging name 도시 일치', () => {
  function makeMultiCityItin() {
    return {
      days: [
        { day: 1, city: 'seoul', stops: [{ category: 'culture', name: '경복궁', start_time: '10:00', end_time: '12:00' }] },
        { day: 2, city: 'busan', stops: [{ category: 'culture', name: '해운대해변', start_time: '10:00', end_time: '12:00' }] },
      ],
    };
  }

  it('backfillDayLodging: 부산 day lodging name = 부산 호텔 (기존 null 버그 제거)', () => {
    const itin = makeMultiCityItin();
    backfillDayLodging(itin, { seoul: '명동 신라스테이', busan: '해운대 시그니엘' });
    expect(itin.days[0].lodging.name).toBe('명동 신라스테이');
    expect(itin.days[1].lodging.name).toBe('해운대 시그니엘'); // 부산 = 부산 호텔
    expect(itin.days[1].lodging.name).not.toBeNull(); // 기존 버그 = null
    // name 과 address 가 같은 도시 (자가모순 0)
    expect(itin.days[1].lodging.name).toBe(itin.days[1].lodging.address);
  });

  it('selfHealLodgingBookend: 부산 day stop name = 부산 호텔 (서울 전역 fallback 모순 차단)', () => {
    const itin = makeMultiCityItin();
    backfillDayLodging(itin, { seoul: '명동 신라스테이', busan: '해운대 시그니엘' });
    // ctx.hotel_address = 전역 첫도시(서울) — 이게 부산 day 에 새면 자가모순 (기존 버그)
    selfHealLodgingBookend(itin, { hotel_address: '명동 신라스테이' });
    const busanLodging = (itin.days[1].stops || []).find((s) => s.category === 'lodging');
    expect(busanLodging).toBeDefined();
    expect(busanLodging.name).toBe('해운대 시그니엘'); // P322 핵심: 서울 호텔명 아님
    expect(busanLodging.name).not.toContain('명동');
  });

  it('en 사용자 동작 동일 (회귀 0) — Seoul/Busan 영문 city', () => {
    const itin = {
      days: [
        { day: 1, city: 'Seoul', stops: [{ category: 'culture', name: 'Palace', start_time: '10:00', end_time: '12:00' }] },
        { day: 2, city: 'Busan', stops: [{ category: 'culture', name: 'Beach', start_time: '10:00', end_time: '12:00' }] },
      ],
    };
    backfillDayLodging(itin, { seoul: 'Shilla Stay Myeongdong', busan: 'Signiel Haeundae' });
    expect(itin.days[1].lodging.name).toBe('Signiel Haeundae');
    expect(itin.days[1].lodging.name).not.toBeNull();
  });
});
