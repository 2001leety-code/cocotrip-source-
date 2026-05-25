/**
 * P188 regression: CITY_MAP yeosu/daegu/gangneung dead fallback 제거
 *
 * 5/25 DB sweep 발견:
 *   - yeosu  → busan fallback 이었으나 DB row 25개 존재
 *   - daegu  → busan fallback 이었으나 DB row 43개 존재
 *   - gangneung → seoul fallback 이었으나 DB row 26개 존재
 *
 * 이 테스트는 다음을 보장한다:
 *   1. CITY_MAP 에서 yeosu 가 busan 으로 fallback 되지 않음
 *   2. CITY_MAP 에서 daegu 가 busan 으로 fallback 되지 않음
 *   3. CITY_MAP 에서 gangneung 이 seoul 로 fallback 되지 않음
 *   4. _food_index.json 에 yeosu/daegu/gangneung 각 1+ row 실존
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

// _food_helper.js 에서 CITY_MAP 블록을 추출하는 헬퍼
function parseCityMap(): Record<string, string> {
  const src = readFileSync(resolve(ROOT, 'api/_food_helper.js'), 'utf-8');
  // CITY_MAP = { ... } 블록 추출
  const match = src.match(/const\s+CITY_MAP\s*=\s*\{([\s\S]*?)\}/);
  if (!match) throw new Error('CITY_MAP not found in api/_food_helper.js');

  const body = match[1];
  const map: Record<string, string> = {};

  // key: 'value' 또는 key: "value" 패턴 파싱 (한국어 키 포함)
  const lineRe = /['"]?([^'":\s]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

describe('P188 — CITY_MAP dead fallback 제거', () => {
  it('yeosu 가 busan 으로 fallback 되지 않음', () => {
    const cityMap = parseCityMap();
    // yeosu 키가 존재하면 busan 이 아닌 값이어야 함
    if ('yeosu' in cityMap) {
      expect(cityMap['yeosu']).not.toBe('busan');
    }
    // 키가 없어도 통과 (자기 자신 fallback 패턴 — CITY_MAP[city] || city)
  });

  it('daegu 가 busan 으로 fallback 되지 않음', () => {
    const cityMap = parseCityMap();
    if ('daegu' in cityMap) {
      expect(cityMap['daegu']).not.toBe('busan');
    }
  });

  it('gangneung 이 seoul 로 fallback 되지 않음', () => {
    const cityMap = parseCityMap();
    if ('gangneung' in cityMap) {
      expect(cityMap['gangneung']).not.toBe('seoul');
    }
  });

  it('_food_index.json 에 yeosu/daegu/gangneung row 각 1+ 존재', () => {
    const raw = readFileSync(resolve(ROOT, 'api/_food_index.json'), 'utf-8');
    const index: Array<{ city: string }> = JSON.parse(raw);

    const counts: Record<string, number> = { yeosu: 0, daegu: 0, gangneung: 0 };
    for (const r of index) {
      if (r.city in counts) counts[r.city]++;
    }

    // 실측: yeosu 25 / daegu 43 / gangneung 26
    expect(counts.yeosu).toBeGreaterThanOrEqual(1);
    expect(counts.daegu).toBeGreaterThanOrEqual(1);
    expect(counts.gangneung).toBeGreaterThanOrEqual(1);
  });
});
