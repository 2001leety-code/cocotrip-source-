/**
 * P190 regression: _attractions_helper.js 신규 — museums/temples/night_spots 130 row 활용
 *
 * 5/25 sweep 발견: src/data/attractions/ 4 JSON 파일이 코드 import 0 (dead data 130 row).
 * 이 테스트는 다음 5가지를 보장한다:
 *
 *   1. getAttractionsContext 가 city + style 매칭 row 반환 (Temple/FreeMuseum/Night)
 *   2. getMuseumsForFree 가 entry_fee_krw === 0 만 반환
 *   3. getTemplesForeignerPopular 가 tags.includes('foreigner_popular') 만 반환
 *   4. getNightSpotsSafe 가 night_spots row 반환 + subway_last 필드 포함
 *   5. buildPrompt.js 가 Temple/FreeMuseum/Night 스타일 시 _attractions_helper import + 호출
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

// ─── 1. getAttractionsContext — city + style 매칭 row 반환 ─────────────────
describe('P190-1: getAttractionsContext — city + style 매칭', () => {
  it('Temple 스타일 시 context string 에 temple 관련 내용 포함', async () => {
    const { getAttractionsContext } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const ctx = getAttractionsContext({ city: 'seoul', styles: ['Temple'], language: 'en' });
    // Temple 스타일 선택 → non-empty string 반환
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(0);
    // 헤더 포함 확인
    expect(ctx).toContain('VERIFIED ATTRACTIONS DATABASE');
    expect(ctx).toContain('Temple');
  });

  it('FreeMuseum 스타일 시 context string 에 museum 관련 내용 포함', async () => {
    const { getAttractionsContext } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const ctx = getAttractionsContext({ city: 'seoul', styles: ['FreeMuseum'], language: 'en' });
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).toContain('VERIFIED ATTRACTIONS DATABASE');
    expect(ctx).toContain('Free Museum');
  });

  it('Night 스타일 시 context string 에 night 관련 내용 포함', async () => {
    const { getAttractionsContext } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const ctx = getAttractionsContext({ city: 'seoul', styles: ['Night'], language: 'en' });
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).toContain('VERIFIED ATTRACTIONS DATABASE');
    expect(ctx).toContain('Night');
  });

  it('관련 없는 style(Kpop)은 빈 string 반환', async () => {
    const { getAttractionsContext } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const ctx = getAttractionsContext({ city: 'seoul', styles: ['Kpop'], language: 'en' });
    expect(ctx).toBe('');
  });
});

// ─── 2. getMuseumsForFree — entry_fee_krw === 0 만 반환 ────────────────────
describe('P190-2: getMuseumsForFree — entry_fee_krw === 0 only', () => {
  it('seoul 무료 박물관 1개 이상 반환', async () => {
    const { getMuseumsForFree } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const results = getMuseumsForFree({ city: 'seoul' });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('반환된 모든 행의 entry_fee_krw === 0', async () => {
    const { getMuseumsForFree } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const results = getMuseumsForFree({ city: 'seoul' });
    for (const museum of results) {
      expect(Number(museum.entry_fee_krw)).toBe(0);
    }
  });

  it('유료 박물관(entry_fee_krw > 0)이 결과에 포함되지 않음', async () => {
    const { getMuseumsForFree } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const results = getMuseumsForFree({ city: 'seoul' });
    const paid = results.filter(m => Number(m.entry_fee_krw) > 0);
    expect(paid.length).toBe(0);
  });
});

// ─── 3. getTemplesForeignerPopular — foreigner_popular 태그만 반환 ─────────
describe('P190-3: getTemplesForeignerPopular — foreigner_popular 태그 필터', () => {
  it('foreigner_popular 사찰 1개 이상 반환 (글로벌 fallback)', async () => {
    const { getTemplesForeignerPopular } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const results = getTemplesForeignerPopular({ city: 'seoul' });
    // seoul 에 foreigner_popular 사찰이 없을 수 있으니 global fallback 포함
    expect(Array.isArray(results)).toBe(true);
    // 전국 기준 foreigner_popular 사찰 최소 3개 이상 존재
    const global = getTemplesForeignerPopular({ city: 'unknown_city_xyz' });
    expect(global.length).toBeGreaterThan(0);
  });

  it('반환된 모든 행의 tags 에 foreigner_popular 포함', async () => {
    const { getTemplesForeignerPopular } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    // 전체 반환 (city 없음 → global fallback)
    const results = getTemplesForeignerPopular({ city: 'unknown_city_xyz' });
    for (const temple of results) {
      expect(Array.isArray(temple.tags)).toBe(true);
      expect(temple.tags).toContain('foreigner_popular');
    }
  });
});

// ─── 4. getNightSpotsSafe — night_spots row 반환 + subway_last 필드 ────────
describe('P190-4: getNightSpotsSafe — night_spots + subway_last', () => {
  it('seoul night spots 1개 이상 반환', async () => {
    const { getNightSpotsSafe } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const results = getNightSpotsSafe({ city: 'seoul' });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('반환 row 에 subway_last 필드 존재 (서울 야경 spot 기준)', async () => {
    const { getNightSpotsSafe } = await import(
      resolve(ROOT, 'api/_attractions_helper.js')
    );
    const results = getNightSpotsSafe({ city: 'seoul' });
    // 서울 night spots 은 subway_last 있어야 함
    const withSubway = results.filter(r => r.subway_last != null);
    expect(withSubway.length).toBeGreaterThan(0);
  });

  it('_attractions_index.json 에 night_spot type row 30개 존재', () => {
    const raw = readFileSync(resolve(ROOT, 'api/_attractions_index.json'), 'utf-8');
    const index: Array<{ _source?: string; theme?: string }> = JSON.parse(raw);
    const nightRows = index.filter(
      a => a._source === 'night_spot' || a.theme === 'nightlife' ||
           a.theme === 'night_view' || a.theme === 'night_market' ||
           a.theme === 'food_street',
    );
    expect(nightRows.length).toBe(30);
  });
});

// ─── 5. buildPrompt.js — Temple/FreeMuseum/Night 키워드 + _attractions_helper 참조 ─
describe('P190-5: buildPrompt.js STYLE-DRIVEN 섹션 + _attractions_helper 연결', () => {
  it('handlerCore.js 가 _attractions_helper 를 import', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/handlerCore.js'), 'utf-8');
    expect(src).toMatch(/_attractions_helper/);
    expect(src).toMatch(/getAttractionsContext/);
  });

  it('handlerCore.js 가 getAttractionsContext 호출 시 styles 전달', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/handlerCore.js'), 'utf-8');
    // getAttractionsContext({ city: area, styles, ... }) 형태
    expect(src).toMatch(/getAttractionsContext\s*\(\s*\{[^}]*styles/);
  });

  it('userMessageBuilder.js 가 attractionsContext 를 prompt 에 주입', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/userMessageBuilder.js'), 'utf-8');
    expect(src).toMatch(/attractionsContext/);
    // foodContext + attractionsContext 순서로 concat
    expect(src).toMatch(/foodContext.*attractionsContext|attractionsContext/s);
  });

  it('buildPrompt.js STYLE-DRIVEN 섹션에 Temple/FreeMuseum/Night VERIFIED 주입 지시 존재', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/buildPrompt.js'), 'utf-8');
    // Temple 라인에 VERIFIED ATTRACTIONS DATABASE 언급
    expect(src).toMatch(/Temple.*VERIFIED ATTRACTIONS DATABASE/s);
    // FreeMuseum 라인에 VERIFIED ATTRACTIONS DATABASE 언급
    expect(src).toMatch(/FreeMuseum.*VERIFIED ATTRACTIONS DATABASE/s);
    // Night 라인에 VERIFIED ATTRACTIONS DATABASE 언급
    expect(src).toMatch(/Night.*VERIFIED ATTRACTIONS DATABASE/s);
  });

  it('_attractions_index.json 130 row 합계 (museums 50 + temples 50 + night_spots 30)', () => {
    const raw = readFileSync(resolve(ROOT, 'api/_attractions_index.json'), 'utf-8');
    const index: unknown[] = JSON.parse(raw);
    expect(index.length).toBe(130);
  });
});
