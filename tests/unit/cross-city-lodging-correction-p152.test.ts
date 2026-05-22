/**
 * P152 (2026-05-22): correctCrossCityLodgingStops — cross-city lodging 강제 교정 회귀 차단.
 *
 * 9-시나리오 시뮬레이션 7/9 실패 (D2(Busan):"서울역 호텔" / D4(Seoul):"제주시 호텔" 등).
 * buildPrompt + userMessageBuilder 만으로는 Gemini 비결정성 못 잡음 → 마지막 안전망.
 *
 * 본 테스트가 보장:
 *   - 도시 교차 lodging stop 자동 교정
 *   - 사용자 hotelByCity 우선, recommendedZones 차순위, default placeholder 마지막
 *   - quality_warnings 에 박제 (운영자 UI 노출)
 *   - 정상 케이스 (도시 매칭) 는 override 안 함
 */
import { describe, it, expect } from 'vitest';
import { correctCrossCityLodgingStops } from '../../api/_ai_core/planPersister.js';

describe('P152 correctCrossCityLodgingStops', () => {
  it('Busan day 에 "명동 호텔" 박힌 stop 을 부산 placeholder 로 교정', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Busan',
          stops: [
            { category: 'lodging', name: '명동 호텔 체크아웃', address: '서울특별시 중구 명동' },
            { category: 'food', name: '광안리 회센터', address: '부산광역시 수영구' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});

    expect(violations).toHaveLength(1);
    expect(violations[0].day_city).toBe('Busan');
    expect(violations[0].conflicting_city).toBe('seoul');
    // 기본 placeholder = "해운대 호텔 (위치 미정)"
    expect(itinerary.days[0].stops[0].name).toContain('해운대');
    expect(itinerary.days[0].stops[0]._corrected_cross_city).toBe(true);
    expect(itinerary.quality_warnings).toHaveLength(1);
    expect(itinerary.quality_warnings[0].kind).toBe('cross_city_lodging_corrected');
  });

  it('사용자 hotelByCity 우선 — 명시한 부산 호텔 주소 사용', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Busan',
          stops: [
            { category: 'lodging', name: '서울역 근처 호텔', address: '서울 중구' },
          ],
        },
      ],
    } as any;

    const hotelByCity = { busan: '해운대 그랜드 호텔, 부산광역시 해운대구 마린시티로 12' };

    correctCrossCityLodgingStops(itinerary, hotelByCity, {});

    expect(itinerary.days[0].stops[0].address).toContain('해운대 그랜드');
    expect(itinerary.days[0].stops[0].name).toContain('부산');
  });

  it('recommendedZones 차순위 — zone 기반 placeholder', () => {
    const itinerary = {
      days: [
        {
          day: 4,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '제주시 호텔', address: '제주특별자치도' },
          ],
        },
      ],
    } as any;

    const recommendedZones = { seoul: 'hongdae' };

    correctCrossCityLodgingStops(itinerary, {}, recommendedZones);

    expect(itinerary.days[0].stops[0].name).toContain('hongdae');
    expect(itinerary.days[0].stops[0].address).toContain('서울');
  });

  it('정상 케이스 (도시 매칭) 는 override 안 함', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '명동 호텔', address: '서울특별시 중구 명동' },
          ],
        },
        {
          day: 2,
          city: 'Busan',
          stops: [
            { category: 'lodging', name: '해운대 호텔', address: '부산광역시 해운대구' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});

    expect(violations).toHaveLength(0);
    expect(itinerary.days[0].stops[0].name).toBe('명동 호텔');
    expect(itinerary.days[1].stops[0].name).toBe('해운대 호텔');
    expect(itinerary.quality_warnings).toBeUndefined();
  });

  it('non-lodging stops 은 건드리지 않음', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Busan',
          stops: [
            { category: 'food', name: '명동 칼국수', address: '서울특별시 중구' },
            { category: 'attraction', name: '서울타워', address: '서울 용산구' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});

    expect(violations).toHaveLength(0);
    expect(itinerary.days[0].stops[0].name).toBe('명동 칼국수'); // 음식점은 도시 교차 무관
  });

  it('영문 도시명 (Seoul/Busan) 도 감지', () => {
    const itinerary = {
      days: [
        {
          day: 2,
          city: 'Busan',
          stops: [
            { category: 'lodging', name: 'Seoul Station Hotel', address: 'Seoul, Yongsan-gu' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});

    expect(violations).toHaveLength(1);
    expect(violations[0].conflicting_city).toBe('seoul');
  });

  it('day.city 없으면 skip (no-op)', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          stops: [
            { category: 'lodging', name: '명동 호텔', address: '서울 중구' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});
    expect(violations).toHaveLength(0);
  });

  it('P156: ${city}시 suffix 매칭 — "경주시 황리단길..." 부산 day에', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Busan',
          stops: [
            { category: 'lodging', name: '황리단길 호텔', address: '경주시 황리단길 일대' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});

    expect(violations).toHaveLength(1);
    expect(violations[0].conflicting_city).toBe('gyeongju');
  });

  it('P156: 동네명 매핑 — "황리단길 호텔" Seoul day (도시명 없어도 잡힘)', () => {
    const itinerary = {
      days: [
        {
          day: 4,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '황리단길 호텔 (호텔 미정)', address: '' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});

    expect(violations).toHaveLength(1);
    expect(violations[0].conflicting_city).toBe('gyeongju');
  });

  it('P156: 동네명 매핑 — "해운대 호텔" Seoul day', () => {
    const itinerary = {
      days: [
        {
          day: 2,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '해운대 그랜드 호텔', address: '미정' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});

    expect(violations).toHaveLength(1);
    expect(violations[0].conflicting_city).toBe('busan');
  });

  it('P156: 같은 도시 동네는 통과 — "명동 호텔" Seoul day', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '명동 호텔', address: '명동' },
          ],
        },
      ],
    } as any;

    const violations = correctCrossCityLodgingStops(itinerary, {}, {});
    expect(violations).toHaveLength(0);
  });

  it('quality_warnings 기존 항목 보존 + 추가', () => {
    const itinerary = {
      days: [
        {
          day: 2,
          city: 'Busan',
          stops: [
            { category: 'lodging', name: '명동 호텔', address: '서울 중구' },
          ],
        },
      ],
      quality_warnings: [
        { kind: 'existing_warning', severity: 'low', message: '기존 warning 1건' },
      ],
    } as any;

    correctCrossCityLodgingStops(itinerary, {}, {});

    expect(itinerary.quality_warnings).toHaveLength(2);
    expect(itinerary.quality_warnings[0].kind).toBe('existing_warning');
    expect(itinerary.quality_warnings[1].kind).toBe('cross_city_lodging_corrected');
  });
});
