/**
 * P284 + P285 + P286 + P282-B (2026-05-29): validator batch 회귀 차단.
 *
 * Agent 1 + Agent 2 deep-search 발견 sleeper bug 4건 일괄 fix:
 *   - P284: hotel_address single-city mismatch (B-13 multi-city only → single 도 추가)
 *   - P285: B-DC SOFT circuit breaker log + Telegram alert (env disabled 여도 측정)
 *   - P286: arrival-wrap edge (stopMin < arrivalMin + hour < 5 = wrap 의심)
 *   - P282-B: Jjimjilbang keyword coverage (전국 분포 — keyword check)
 *
 * 회귀 시: sleeper bug 잠복 (운영자 시점 "오류잖아" 패턴 재발).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateResponse, validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

describe('P284-P286 + P282-B validator batch', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/responseValidator.js');
  const src = readFileSync(srcPath, 'utf8');

  // ── P285 (B-DC SOFT log) ─────────────────────────────────────────────────────

  it('P285 source — B-DC SOFT circuit breaker log + Telegram alert', () => {
    expect(src).toContain('P285');
    expect(src).toContain('silent mode 차단');
    expect(src).toContain('[P285 B-DC mismatch]');
    expect(src).toContain('P285 B-DC mismatch');
    // Telegram alert 호출 존재
    expect(src).toMatch(/throttledTelegramAlert/);
  });

  // ── P286 (arrival-wrap edge) ──────────────────────────────────────────────────

  it('P286 source — arrival-wrap edge 명시 + 새벽 체크 outer if 밖으로 move', () => {
    expect(src).toContain('P286');
    expect(src).toContain('arrival-wrap edge');
    expect(src).toContain('wrapHint');
    expect(src).toMatch(/stopMin\s*<\s*arrivalMin/);
  });

  // ── P284 (hotel single-city) ──────────────────────────────────────────────────

  it('P284 source — hotel_address single-city mismatch validator', () => {
    expect(src).toContain('P284');
    expect(src).toContain('hotel_address single-city mismatch');
    expect(src).toContain('hotel_address_single_city_mismatch');
    // multi-city skip 분기 존재
    expect(src).toContain('!isMultiCityReq');
    // GENERIC_TOKENS exclude logic
    expect(src).toContain('GENERIC_TOKENS');
  });

  // ── P282-B (Jjimjilbang) ──────────────────────────────────────────────────────

  it('P282-B source — Jjimjilbang keyword coverage validator', () => {
    expect(src).toContain('P282-B');
    expect(src).toContain('jjimjilbang_coverage_zero');
    expect(src).toMatch(/찜질방\|jjimjilbang\|sauna\|spa land/);
  });

  // ── Runtime: P284 hotel single-city ───────────────────────────────────────────

  function makeData(stops: Array<any>) {
    return { days: [{ stops }] };
  }

  it('runtime P284 — hotel_address single-city + lodging mismatch → 박제', () => {
    const data = makeData([
      { name: '강남 호텔', category: 'lodging', address: '서울특별시 강남구' },
      { name: '명동교자', category: 'food', address: '서울특별시 중구 명동' },
    ]);
    const issues = validateResponse(data, {
      hotel_address: '명동 롯데호텔 서울 중구',
      regions: ['서울'],  // single-city
      styles: [],
      dietary: [],
      lang: 'ko',
    }, []);
    const hotelMismatch = issues.filter((i) => i.type === 'hotel_address_single_city_mismatch');
    expect(hotelMismatch.length).toBe(1);
    expect(hotelMismatch[0].mismatch_count).toBe(1);
    expect(hotelMismatch[0].severity).toBe('medium');
  });

  it('runtime P284 — hotel_address single-city + lodging 매칭 → 박제 X', () => {
    const data = makeData([
      { name: '명동 롯데호텔', category: 'lodging', address: '서울특별시 중구 명동' },
      { name: '명동교자', category: 'food', address: '서울특별시 중구 명동' },
    ]);
    const issues = validateResponse(data, {
      hotel_address: '명동 롯데호텔 서울 중구',
      regions: ['서울'],
      styles: [],
      dietary: [],
      lang: 'ko',
    }, []);
    const hotelMismatch = issues.filter((i) => i.type === 'hotel_address_single_city_mismatch');
    expect(hotelMismatch.length).toBe(0);
  });

  it('runtime P284 — multi-city (regions ≥ 2) → P284 skip (B-13 multi-city 가 검증)', () => {
    const data = makeData([
      { name: '강남 호텔', category: 'lodging', address: '서울특별시 강남구' },
    ]);
    const issues = validateResponse(data, {
      hotel_address: '명동 롯데호텔',
      regions: ['서울', '부산'],  // multi-city
      styles: [],
      dietary: [],
      lang: 'ko',
    }, []);
    const hotelMismatch = issues.filter((i) => i.type === 'hotel_address_single_city_mismatch');
    expect(hotelMismatch.length).toBe(0);
  });

  it('runtime P284 — hotel_address 없음 → skip', () => {
    const data = makeData([
      { name: '강남 호텔', category: 'lodging', address: '서울특별시 강남구' },
    ]);
    const issues = validateResponse(data, {
      regions: ['서울'],
      styles: [],
      dietary: [],
      lang: 'ko',
    }, []);
    const hotelMismatch = issues.filter((i) => i.type === 'hotel_address_single_city_mismatch');
    expect(hotelMismatch.length).toBe(0);
  });

  // ── Runtime: P282-B Jjimjilbang ───────────────────────────────────────────────

  it('runtime P282-B — styles=[Jjimjilbang] + 0 keyword match → coverage_zero 박제', () => {
    const data = makeData([
      { name: '명동교자', category: 'food', address: '서울특별시 중구 명동' },
      { name: '경복궁', category: 'culture', address: '서울특별시 종로구' },
    ]);
    const issues = validateResponse(data, {
      styles: ['Jjimjilbang'],
      dietary: [],
      lang: 'ko',
    }, []);
    const coverage = issues.filter((i) => i.type === 'jjimjilbang_coverage_zero');
    expect(coverage.length).toBe(1);
    expect(coverage[0].severity).toBe('medium');
  });

  it('runtime P282-B — styles=[Jjimjilbang] + 찜질방 키워드 stop ≥ 1 → 박제 X', () => {
    const data = makeData([
      { name: '명동 찜질방', category: 'activity', address: '서울특별시 중구' },
    ]);
    const issues = validateResponse(data, {
      styles: ['Jjimjilbang'],
      dietary: [],
      lang: 'ko',
    }, []);
    const coverage = issues.filter((i) => i.type === 'jjimjilbang_coverage_zero');
    expect(coverage.length).toBe(0);
  });

  it('runtime P282-B — styles=[] (Jjimjilbang 없음) → skip', () => {
    const data = makeData([
      { name: '명동교자', category: 'food', address: '서울특별시 중구' },
    ]);
    const issues = validateResponse(data, {
      styles: [],
      dietary: [],
      lang: 'ko',
    }, []);
    const coverage = issues.filter((i) => i.type === 'jjimjilbang_coverage_zero');
    expect(coverage.length).toBe(0);
  });
});
