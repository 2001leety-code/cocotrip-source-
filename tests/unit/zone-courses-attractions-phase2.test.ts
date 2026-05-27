// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — attractions-based zone_courses JSON schema validation
//
// 회귀 차단:
//   - 8 new zone_course JSON 파일이 blockMode.js 와 호환되는 필수 스키마를 갖추고 있는지.
//   - fetchAvailableBlocks() 가 city_day block_type 만 허용하므로 해당 필드 필수.
//   - stops.length >= 3 (blockMode.js:73 조건).
//   - 4-lang i18n (ko/en/ja/zh) theme_i18n 존재.
//   - SAFETY-CRITICAL dietary_options 배열 존재.
//   - 음식 placeholder stop 이 food category 인지 확인.
//   - _food_index.json / _attractions_index.json 는 변경하지 않음.
//
// 참조:
//   - api/_ai_core/blockMode.js fetchAvailableBlocks() L58-93
//   - docs/ADR-DB-BLOCK-SYSTEM-2026-05-27.md
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../');
const ZONE_DIR = join(ROOT, 'src', 'data', 'zone_courses');

// Phase 2 새로 추가된 파일 목록
const PHASE2_FILES = [
  'seoul_museum_history_standard.json',
  'seoul_museum_art_standard.json',
  'seoul_temple_culture_standard.json',
  'seoul_night_experience_standard.json',
  'busan_museum_culture_standard.json',
  'busan_temple_sea_standard.json',
  'gyeongju_heritage_packed.json',
  'gyeongju_temple_history_standard.json',
  'jeju_museum_culture_standard.json',
  'jeju_temple_night_standard.json',
];

// blockMode.js fetchAvailableBlocks 가 허용하는 block_type
const ALLOWED_BLOCK_TYPES = ['city_day'];

// 4-lang i18n keys
const I18N_LANGS = ['ko', 'en', 'ja', 'zh'] as const;

function loadBlock(filename: string): Record<string, unknown> {
  const filepath = join(ZONE_DIR, filename);
  const raw = readFileSync(filepath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('Phase 2 zone_course JSON files — blockMode compatibility', () => {
  // ── 파일 존재 확인 ──────────────────────────────────────────────────────
  describe('모든 Phase 2 파일이 존재해야 함', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} 존재`, () => {
        const block = loadBlock(filename);
        expect(block).toBeDefined();
        expect(typeof block).toBe('object');
      });
    }
  });

  // ── 필수 기본 필드 ─────────────────────────────────────────────────────
  describe('필수 기본 필드 검증', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — id/city/zone/theme 필드 존재`, () => {
        const block = loadBlock(filename);
        expect(typeof block.id).toBe('string');
        expect((block.id as string).length).toBeGreaterThan(0);
        expect(typeof block.city).toBe('string');
        expect(typeof block.zone).toBe('string');
        expect(typeof block.theme).toBe('string');
      });
    }
  });

  // ── blockMode.js 호환 — block_type='city_day' ──────────────────────────
  describe('blockMode.js 호환 — block_type 검증', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — block_type='city_day' (fetchAvailableBlocks 필터 통과)`, () => {
        const block = loadBlock(filename);
        expect(ALLOWED_BLOCK_TYPES).toContain(block.block_type);
      });
    }
  });

  // ── blockMode.js stops.length >= 3 조건 ───────────────────────────────
  describe('blockMode.js 호환 — stops 최소 3개', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — stops.length >= 3`, () => {
        const block = loadBlock(filename);
        const stops = block.stops as unknown[];
        expect(Array.isArray(stops)).toBe(true);
        expect(stops.length).toBeGreaterThanOrEqual(3);
      });
    }
  });

  // ── 4-lang i18n theme_i18n ────────────────────────────────────────────
  describe('4-lang i18n — theme_i18n 존재', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — theme_i18n ko/en/ja/zh 모두 존재`, () => {
        const block = loadBlock(filename);
        const themeI18n = block.theme_i18n as Record<string, string> | undefined;
        expect(themeI18n).toBeDefined();
        for (const lang of I18N_LANGS) {
          expect(typeof themeI18n![lang]).toBe('string');
          expect(themeI18n![lang].length).toBeGreaterThan(0);
        }
      });
    }
  });

  // ── dietary_options 배열 존재 (blockMode.js SAFETY-CRITICAL 필터용) ───
  describe('SAFETY — dietary_options 배열 존재', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — dietary_options 배열`, () => {
        const block = loadBlock(filename);
        expect(Array.isArray(block.dietary_options)).toBe(true);
        const opts = block.dietary_options as string[];
        expect(opts.length).toBeGreaterThan(0);
        // standard 는 반드시 포함 (base option)
        expect(opts).toContain('standard');
      });
    }
  });

  // ── stops 각 항목 order 필드 고유 + 1-indexed ─────────────────────────
  describe('stops 구조 — order 필드 고유', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — stops[].order 고유 + 양수`, () => {
        const block = loadBlock(filename);
        const stops = block.stops as Array<Record<string, unknown>>;
        const orders = stops.map((s) => s.order as number);
        const unique = new Set(orders);
        expect(unique.size).toBe(orders.length); // 중복 없음
        expect(orders.every((o) => typeof o === 'number' && o >= 1)).toBe(true);
      });
    }
  });

  // ── food placeholder stop 이 category='food' ─────────────────────────
  describe('food placeholder 일관성', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — placeholder 있는 stop 은 category='food'`, () => {
        const block = loadBlock(filename);
        const stops = block.stops as Array<Record<string, unknown>>;
        for (const stop of stops) {
          if (stop.placeholder) {
            expect(stop.category).toBe('food');
          }
        }
      });
    }
  });

  // ── 문화/명소 stop 에 name + name_i18n 존재 ──────────────────────────
  describe('문화 stop — name 필드 존재', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — culture stop 에 name 존재`, () => {
        const block = loadBlock(filename);
        const stops = block.stops as Array<Record<string, unknown>>;
        const cultureStops = stops.filter(
          (s) => s.category !== 'food' && !s.placeholder,
        );
        for (const stop of cultureStops) {
          expect(typeof stop.name).toBe('string');
          expect((stop.name as string).length).toBeGreaterThan(0);
          const nameI18n = stop.name_i18n as Record<string, string> | undefined;
          expect(nameI18n).toBeDefined();
          expect(typeof nameI18n!.en).toBe('string');
          expect(nameI18n!.en.length).toBeGreaterThan(0);
        }
      });
    }
  });

  // ── start_time_offset_min 단조 증가 (순서 유효성) ────────────────────
  describe('stops 시간 순서 — start_time_offset_min 단조 비감소', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — start_time_offset_min 단조 증가`, () => {
        const block = loadBlock(filename);
        const stops = (block.stops as Array<Record<string, unknown>>)
          .filter((s) => typeof s.start_time_offset_min === 'number')
          .sort((a, b) => (a.order as number) - (b.order as number));
        for (let i = 1; i < stops.length; i++) {
          const prev = stops[i - 1].start_time_offset_min as number;
          const curr = stops[i].start_time_offset_min as number;
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      });
    }
  });

  // ── best_for 배열 존재 (Gemini block 선택 다양성) ────────────────────
  describe('best_for 배열 존재', () => {
    for (const filename of PHASE2_FILES) {
      it(`${filename} — best_for 배열`, () => {
        const block = loadBlock(filename);
        expect(Array.isArray(block.best_for)).toBe(true);
        expect((block.best_for as string[]).length).toBeGreaterThan(0);
      });
    }
  });

  // ── 중복 ID 없음 (전체 zone_courses 디렉토리 범위) ───────────────────
  it('zone_courses 전체 — id 중복 없음 (Phase 2 포함)', () => {
    const allFiles = readdirSync(ZONE_DIR).filter(
      (f) => f.endsWith('.json') && !f.includes('/'),
    );
    const ids: string[] = [];
    const dupes: string[] = [];
    for (const file of allFiles) {
      try {
        const block = loadBlock(file);
        const id = block.id as string;
        if (ids.includes(id)) {
          dupes.push(`${id} (${file})`);
        } else {
          ids.push(id);
        }
      } catch {
        // JSON 파싱 실패는 다른 테스트에서 잡음
      }
    }
    expect(dupes).toHaveLength(0);
  });
});
