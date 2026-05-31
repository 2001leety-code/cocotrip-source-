/**
 * P297 (2026-05-29): correctCrossCityLodgingStops personalize 회귀 차단.
 *
 * 발견: P296 서울+부산 5일 전체 테스트 plan 03cac32d Day 5 —
 *   Gemini 가 Day 5 (city=Seoul, 출국일) 에 부산 호텔 "해운대 시그니엘" 잘못 emit
 *   → correctCrossCityLodgingStops 가 cross-city 감지·교정했지만 generic "서울 호텔"
 *   placeholder 사용 → name="서울 호텔" + addr="명동 신라스테이" 자가 불일치.
 *
 * Root cause: planPersister.js:325-327 — hbc[dayCityLc] 있으면 newAddress 는 사용자
 *   호텔, 하지만 newName 은 `${dayCityKor} 호텔` generic placeholder.
 *
 * P297 fix: hbc[dayCityLc] 있으면 newName 도 사용자 호텔명 사용 (P290 패턴 동일).
 *
 * 회귀 시: 사용자 입력 호텔이 cross-city 교정 후 generic "서울 호텔" 로 표시 (P290 personalize 위반).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — JS module
import { correctCrossCityLodgingStops } from '../../api/_ai_core/planPersister.js';

describe('P297 correctCrossCityLodgingStops personalize (generic placeholder → 사용자 호텔)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/planPersister.js');
  const src = readFileSync(srcPath, 'utf8');

  // ── source pattern ────────────────────────────────────────────────────────

  it('source — P297 주석 + userHotel 변수', () => {
    expect(src).toContain('P297');
    expect(src).toMatch(/const\s+userHotel\s*=\s*hbc\[dayCityLc\]\.trim\(\)/);
    // newName 도 userHotel 사용 (generic "서울 호텔" 아님)
    expect(src).toMatch(/newName\s*=\s*userHotel/);
  });

  it('source — hbc 분기 안에서 userHotel 사용 (generic placeholder 제거)', () => {
    // hbc 분기 (첫 if 블록) 안에 userHotel 변수 사용 → generic "{city} 호텔" 대신.
    const hbcBlock = src.match(/if \(hbc\[dayCityLc\][\s\S]{0,800}?\} else if \(rz\[dayCityLc\]\)/);
    expect(hbcBlock).toBeTruthy();
    expect(hbcBlock![0]).toContain('userHotel');
    // hbc 분기 안에서 newName = userHotel (generic `${dayCityKor || dayCityLc} 호텔` 아님)
    expect(hbcBlock![0]).toMatch(/newName\s*=\s*userHotel/);
  });

  // ── runtime ────────────────────────────────────────────────────────────────

  it('runtime — P296 재현: Day 5 Seoul + 부산 호텔 → 사용자 서울 호텔명으로 교정', () => {
    const itinerary = {
      days: [
        {
          day: 5,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '해운대 시그니엘', address: '부산광역시 해운대구 달맞이길 30' },
            { category: 'food', name: '명동교자', address: '서울 중구' },
          ],
        },
      ],
    };
    const violations = correctCrossCityLodgingStops(itinerary, { seoul: '명동 신라스테이' }, {});
    expect(violations.length).toBe(1);
    const lodging = itinerary.days[0].stops[0];
    // P297: name 도 사용자 호텔 (generic "서울 호텔" 아님)
    expect(lodging.name).toBe('명동 신라스테이');
    expect(lodging.address).toBe('명동 신라스테이');
    // 자가 일치 (name == address, 둘 다 사용자 입력)
    expect(lodging.name).toBe(lodging.address);
    expect(lodging._corrected_cross_city).toBe(true);
  });

  it('runtime — generic "서울 호텔" 회귀 차단 (P297 핵심)', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Seoul',
          stops: [{ category: 'lodging', name: '해운대 호텔', address: '부산광역시 해운대구' }],
        },
      ],
    };
    correctCrossCityLodgingStops(itinerary, { seoul: '강남 그랜드 인터컨티넨탈' }, {});
    const lodging = itinerary.days[0].stops[0];
    expect(lodging.name).not.toBe('서울 호텔');
    expect(lodging.name).toBe('강남 그랜드 인터컨티넨탈');
  });

  it('runtime — hbc 없으면 rz fallback (회귀 차단 — placeholder 유지)', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Busan',
          stops: [{ category: 'lodging', name: '명동 호텔', address: '서울특별시 중구' }],
        },
      ],
    };
    // hbc 없음, rz[busan]='haeundae'
    correctCrossCityLodgingStops(itinerary, {}, { busan: 'haeundae' });
    const lodging = itinerary.days[0].stops[0];
    // rz 분기는 "{zone} 일대 숙소" placeholder (P-launch 2026-05-31: 호텔(위치 미정) → 숙소)
    expect(lodging.name).toContain('haeundae');
    expect(lodging.name).toContain('숙소');
  });

  it('runtime — hbc/rz 모두 없으면 default placeholder (회귀 차단)', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Seoul',
          stops: [{ category: 'lodging', name: '해운대 호텔', address: '부산광역시 해운대구' }],
        },
      ],
    };
    correctCrossCityLodgingStops(itinerary, {}, {});
    const lodging = itinerary.days[0].stops[0];
    // default placeholder (CITY_LODGING_DEFAULT[seoul])
    expect(lodging.name).toBeTruthy();
    expect(lodging._corrected_cross_city).toBe(true);
  });

  it('runtime — cross-city 아니면 교정 X (정상 plan 보존)', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [{ category: 'lodging', name: '명동 신라스테이', address: '서울특별시 중구 삼일대로 358' }],
        },
      ],
    };
    const violations = correctCrossCityLodgingStops(itinerary, { seoul: '명동 신라스테이' }, {});
    expect(violations.length).toBe(0);
    // 변경 없음
    expect(itinerary.days[0].stops[0].name).toBe('명동 신라스테이');
    expect(itinerary.days[0].stops[0]._corrected_cross_city).toBeUndefined();
  });

  it('runtime — quality_warnings 박제 (P152 회귀 차단)', () => {
    const itinerary = {
      days: [
        {
          day: 5,
          city: 'Seoul',
          stops: [{ category: 'lodging', name: '해운대 시그니엘', address: '부산광역시 해운대구' }],
        },
      ],
    };
    correctCrossCityLodgingStops(itinerary, { seoul: '명동 신라스테이' }, {});
    expect(itinerary.quality_warnings).toBeDefined();
    const w = itinerary.quality_warnings.find((x: { kind?: string }) => x.kind === 'cross_city_lodging_corrected');
    expect(w).toBeDefined();
    expect(w.type).toBe('cross_city_lodging_corrected');
    // corrected_name 이 사용자 호텔
    expect(w.corrected_name).toBe('명동 신라스테이');
  });
});
