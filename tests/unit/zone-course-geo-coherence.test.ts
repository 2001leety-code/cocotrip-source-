import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — ESM .js in api/, no type decls
import { computeDayRouteMetrics, isExcessiveDayRoute } from '../../api/_ai_core/routeQuality.js';

// 2026-06-10: 실 5일 plan(550fb532) Day2 26.4km zigzag 의 진짜 원인 = block_mode 가
// 조립하는 zone_course 블록 SEOUL_DAY_TEMPLE_CULTURE_STANDARD 가 "사찰 테마"로 종로(조계사)
// + 강남(봉은사, 8km)을 한 day 에 묶음 (zone 필드가 "Jongno-Gangnam Temple Belt" 라고 자백).
// buildPrompt 변경은 block_mode 를 우회당해 무효였음 → 진짜 fix = 블록 데이터 지리 정합.
// 봉은사(강남) → 창덕궁(종로) 교체로 19.1km → 1.6km. 본 테스트가 그 정합을 잠근다.

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/data/zone_courses');
const load = (f: string) => JSON.parse(readFileSync(join(DIR, `${f}.json`), 'utf8'));
const koreaStops = (j: any) =>
  (j.stops || []).filter((s: any) => typeof s.lat === 'number' && s.lat > 30 && s.lat < 40);

describe('zone_course 지리 정합 (block_mode zigzag 차단)', () => {
  it('SEOUL_DAY_TEMPLE_CULTURE_STANDARD = 종로 밀집 (봉은사 강남 제거)', () => {
    const j = load('seoul_temple_culture_standard');
    const m = computeDayRouteMetrics(koreaStops(j));
    // 봉은사(강남) 가 있으면 path ~19km. 종로 밀집이면 < 6km.
    expect(m.pathKm).toBeLessThan(6);
    expect(isExcessiveDayRoute(m, { maxPathKm: 14, maxRatio: 3.0 })).toBe(false);
  });

  it('SEOUL_DAY_TEMPLE_CULTURE 좌표 stop 전부 종로권 (강남 경도 아님)', () => {
    const j = load('seoul_temple_culture_standard');
    // 종로 ~126.98, 강남 ~127.05. 좌표 박힌 명소 stop 은 전부 종로권(lng < 127.0) 이어야.
    for (const s of koreaStops(j)) {
      expect(s.lng, `${s.name} 가 강남권(lng ${s.lng})`).toBeLessThan(127.02);
    }
    // 봉은사가 다시 들어오지 않게 이름 잠금
    const names = (j.stops || []).map((s: any) => s.name);
    expect(names).not.toContain('봉은사');
  });
});
