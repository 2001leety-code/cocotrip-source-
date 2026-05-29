/**
 * P282 (2026-05-29): HangangBike city-mismatch validator (P246/P248 follow-up).
 *
 * Agent 2 deep-search 발견: prod plan `7431b522-95f4` (styles=['HangangBike']) 한강/bike 키워드 stop 0/7.
 * HangangBike 는 한강 (서울 본류 + 경기 일부) 전용 — 비-서울/경기 stops 생성 시 city-mismatch.
 *
 * 운영자 시점 "HangangBike 골랐는데 부산 해운대 코스 추천" = 결제 후 환불 클레임 위험.
 *
 * 패턴: P246 (DMZ) / P248 (Haenyeo) 와 동일 SOFT validator (no retry/throw, Telegram alert + issues 박제).
 *
 * 회귀 시: niche style city-mismatch sleeper bug 잠복.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateResponse } from '../../api/_ai_core/responseValidator.js';

describe('P282 HangangBike city-mismatch validator (P246/P248 follow-up)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/responseValidator.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — P282 reference + R-P282 marker + HangangBike pattern 정의', () => {
    expect(src).toContain('R-P282');
    expect(src).toContain('HangangBike city-mismatch');
    expect(src).toContain('HANGANGBIKE_CITY_VIOLATION_PATTERNS');
    expect(src).toContain('hangangbike');  // styles 매칭
  });

  it('source — 비-서울/경기 지역 violation patterns 포함', () => {
    // 광역시 / 도 단위
    expect(src).toMatch(/HANGANGBIKE_CITY_VIOLATION_PATTERNS[\s\S]{0,500}'부산광역시'/);
    expect(src).toMatch(/HANGANGBIKE_CITY_VIOLATION_PATTERNS[\s\S]{0,500}'제주특별자치도'/);
    expect(src).toMatch(/HANGANGBIKE_CITY_VIOLATION_PATTERNS[\s\S]{0,500}'강원도'/);
    expect(src).toMatch(/HANGANGBIKE_CITY_VIOLATION_PATTERNS[\s\S]{0,500}'경상남도'/);
  });

  it('source — hangangbike_city_mismatch issue 박제 + Telegram alert', () => {
    expect(src).toContain('hangangbike_city_mismatch');
    expect(src).toContain('P282 HANGANGBIKE_CITY_MISMATCH');
    expect(src).toContain('throttledTelegramAlert');
  });

  // ── runtime — validateResponse 직접 호출 ───────────────────────────────────

  function makeData(stops: Array<any>) {
    return { days: [{ stops }] };
  }

  it('runtime — styles=[HangangBike] + 부산 stop → city_mismatch 박제', () => {
    const data = makeData([
      { name: '한강자전거길', category: 'activity', address: '서울특별시 영등포구 여의도동' },
      { name: '해운대 자전거', category: 'activity', address: '부산광역시 해운대구' },
    ]);
    const issues = validateResponse(data, { styles: ['HangangBike'], dietary: [], lang: 'ko' }, []);
    const mismatch = issues.filter(i => i.type === 'hangangbike_city_mismatch');
    expect(mismatch.length).toBe(1);
    expect(mismatch[0].matched_keyword).toBe('부산광역시');
  });

  it('runtime — styles=[HangangBike] + 서울/경기 only → mismatch 0', () => {
    const data = makeData([
      { name: '한강자전거길', category: 'activity', address: '서울특별시 영등포구 여의도동' },
      { name: '여의도 한강공원', category: 'activity', address: '서울특별시 영등포구 여의도' },
      { name: '한강 잠실', category: 'activity', address: '서울특별시 송파구' },
    ]);
    const issues = validateResponse(data, { styles: ['HangangBike'], dietary: [], lang: 'ko' }, []);
    const mismatch = issues.filter(i => i.type === 'hangangbike_city_mismatch');
    expect(mismatch.length).toBe(0);
  });

  it('runtime — styles=[] (HangangBike 입력 없음) → guard skip', () => {
    const data = makeData([
      { name: '해운대 자전거', category: 'activity', address: '부산광역시 해운대구' },
    ]);
    const issues = validateResponse(data, { styles: [], dietary: [], lang: 'ko' }, []);
    const mismatch = issues.filter(i => i.type === 'hangangbike_city_mismatch');
    expect(mismatch.length).toBe(0);
  });

  it('runtime — styles=[HangangBike, Food] + 다중 비-서울 stops → 각각 박제', () => {
    const data = makeData([
      { name: '한강자전거길', category: 'activity', address: '서울특별시 영등포구' },
      { name: '제주 자전거', category: 'activity', address: '제주특별자치도 제주시' },
      { name: '속초 자전거', category: 'activity', address: '강원도 속초시' },
      { name: '대구 자전거', category: 'activity', address: '대구광역시 동성로' },
    ]);
    const issues = validateResponse(data, { styles: ['HangangBike', 'Food'], dietary: [], lang: 'ko' }, []);
    const mismatch = issues.filter(i => i.type === 'hangangbike_city_mismatch');
    expect(mismatch.length).toBe(3);
    const keywords = mismatch.map(m => m.matched_keyword).sort();
    expect(keywords).toContain('제주특별자치도');
    expect(keywords).toContain('강원도');
    expect(keywords).toContain('대구광역시');
  });

  it('runtime — address 없는 stop (block-mode placeholder) → skip', () => {
    const data = makeData([
      { name: '한강자전거길', category: 'activity', address: '' },  // address 없음
    ]);
    const issues = validateResponse(data, { styles: ['HangangBike'], dietary: [], lang: 'ko' }, []);
    const mismatch = issues.filter(i => i.type === 'hangangbike_city_mismatch');
    expect(mismatch.length).toBe(0);
  });
});
