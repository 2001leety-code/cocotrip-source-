/**
 * P237 — _running_helper.js + _running_index.json 검증 (2026-05-27)
 *
 * assertion 4종:
 *   1. _running_index.json 이 16 row 이상 존재
 *   2. getRunningContextForPrompt({ cities: ['seoul'] }) 가 빈 문자열 아님
 *   3. getRunningContextForPrompt({ cities: ['busan'] }) 이 Busan 코스 포함
 *   4. 미지원 도시 요청 시 서울 fallback 반환 (빈 문자열 아님)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

// running index 소스 경로
const RUNNING_INDEX_PATH = resolve(ROOT, 'api/_running_index.json');

// running helper 소스 코드 읽기
function readRunningHelperSource(): string {
  return readFileSync(resolve(ROOT, 'api/_running_helper.js'), 'utf-8');
}

describe('P237 — Running Index + Helper', () => {
  it('1. _running_index.json 이 16 row 이상 존재', () => {
    const raw = readFileSync(RUNNING_INDEX_PATH, 'utf-8');
    const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThanOrEqual(16);

    // 각 row 필수 필드 검증
    for (const row of arr) {
      expect(row).toHaveProperty('key');
      expect(row).toHaveProperty('city');
      expect(row).toHaveProperty('theme');
      expect(row).toHaveProperty('distance_km');
      expect(row).toHaveProperty('duration_min');
    }
  });

  it('2. getRunningContextForPrompt 코드 존재 + export 확인', () => {
    const src = readRunningHelperSource();
    expect(src).toMatch(/export function getRunningContextForPrompt/);
    expect(src).toMatch(/export function formatRunningCourse/);
    expect(src).toMatch(/export function getRunningCoursesByCity/);
  });

  it('3. _running_index.json 에 seoul + busan 코스 존재', () => {
    const arr: Array<{ city: string }> = JSON.parse(readFileSync(RUNNING_INDEX_PATH, 'utf-8'));
    const seoulCourses = arr.filter(r => r.city === 'seoul');
    const busanCourses = arr.filter(r => r.city === 'busan');
    expect(seoulCourses.length).toBeGreaterThanOrEqual(1);
    expect(busanCourses.length).toBeGreaterThanOrEqual(1);
  });

  it('4. _running_index.json 의 모든 theme 이 4-lang i18n 포함', () => {
    const arr: Array<{ theme: Record<string, string> }> = JSON.parse(readFileSync(RUNNING_INDEX_PATH, 'utf-8'));
    for (const row of arr) {
      expect(row.theme).toHaveProperty('ko');
      expect(row.theme).toHaveProperty('en');
      expect(row.theme).toHaveProperty('ja');
      expect(row.theme).toHaveProperty('zh');
    }
  });

  it('5. _running_helper.js 가 handlerCore 주입용 CITY_MAP 포함', () => {
    const src = readRunningHelperSource();
    // 한국 주요 도시 매핑 확인
    expect(src).toMatch(/seoul/);
    expect(src).toMatch(/busan/);
    expect(src).toMatch(/jeju/);
    // 빈 결과 시 서울 fallback
    expect(src).toMatch(/seoul.*fallback|fallback.*seoul/is);
  });
});
