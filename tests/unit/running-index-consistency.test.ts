/**
 * 러닝 인덱스 일관성 가드 (2026-06-01).
 *
 * 배경(딥서치): `api/_running_index.json` 은 **수기 유지** 데이터(16 entry). 16개 중 3개만
 * zone_courses 소스 파일이 있고(busan_gwangalli / jeju_olle / seoul_hangang_mangwon), 나머지
 * 13개는 index-only(소스 없음). 따라서 mountain 처럼 zone_courses 에서 자동 빌드하면 13개 손실
 * (회귀). build 대신 **읽기 전용 일관성 테스트**로 schema 깨짐 + index↔zone_course drift 만 가드
 * (prod 데이터 무변경). SAFETY: 러닝 거리/시간 표기 누락 차단.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
type RunEntry = {
  key: string; city: string; distance_km: number; duration_min: number;
  intensity: string; start_lat: number; start_lng: number; block_type: string;
  theme: Record<string, string>;
};
const index: RunEntry[] = JSON.parse(readFileSync(resolve(ROOT, 'api/_running_index.json'), 'utf8'));

describe('러닝 인덱스 일관성 (수기 유지 데이터 drift/schema 가드)', () => {
  it('배열 + ≥16 엔트리 (13 index-only + 3 zone_course-backed)', () => {
    expect(Array.isArray(index)).toBe(true);
    expect(index.length).toBeGreaterThanOrEqual(16);
  });

  it('모든 엔트리 필수 필드 + 타입 (SAFETY: 거리/시간 표기 누락 금지)', () => {
    for (const e of index) {
      expect(typeof e.key, `key on ${JSON.stringify(e).slice(0, 60)}`).toBe('string');
      expect(e.key.length).toBeGreaterThan(0);
      expect(typeof e.city).toBe('string');
      expect(e.distance_km, `distance_km on ${e.key}`).toBeGreaterThan(0);
      expect(e.duration_min, `duration_min on ${e.key}`).toBeGreaterThan(0);
      expect(typeof e.intensity).toBe('string');
      expect(typeof e.block_type).toBe('string');
    }
  });

  it('좌표가 한국 범위 내 (잘못된 0/null 좌표 차단)', () => {
    for (const e of index) {
      expect(typeof e.start_lat, `start_lat on ${e.key}`).toBe('number');
      expect(e.start_lat).toBeGreaterThan(33);
      expect(e.start_lat).toBeLessThan(39);
      expect(typeof e.start_lng, `start_lng on ${e.key}`).toBe('number');
      expect(e.start_lng).toBeGreaterThan(124);
      expect(e.start_lng).toBeLessThan(132);
    }
  });

  it('4-lang theme (ko/en/ja/zh) 완비 (위저드 4언어 규칙)', () => {
    for (const e of index) {
      for (const lang of ['ko', 'en', 'ja', 'zh']) {
        expect(typeof e.theme?.[lang], `theme.${lang} on ${e.key}`).toBe('string');
        expect(e.theme[lang].length).toBeGreaterThan(0);
      }
    }
  });

  it('key 중복 없음', () => {
    const keys = index.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('zone_course 백킹 러닝 파일(3)의 id 가 index 에 존재 (drift 가드)', () => {
    const indexKeys = new Set(index.map((e) => e.key));
    const runFiles = [
      'busan_gwangalli_5km_running',
      'jeju_olle_7_5km_running',
      'seoul_hangang_mangwon_5km_running',
    ];
    for (const f of runFiles) {
      const zc = JSON.parse(readFileSync(resolve(ROOT, `src/data/zone_courses/${f}.json`), 'utf8'));
      // zone_course 가 새로 생겼는데 index 에 누락 = drift (프롬프트에서 빠짐).
      expect(indexKeys.has(zc.id), `zone_course ${f} (id=${zc.id}) 가 _running_index.json 에 누락 — drift`).toBe(true);
    }
  });
});
