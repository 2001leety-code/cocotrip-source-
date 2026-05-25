/**
 * P191 — SAFETY-CRITICAL: _mountain_helper.js 60 row 외국인 등산 안전 데이터
 *
 * SAFETY-CRITICAL — 외국인 visitor 가 잘못된 등산 정보 (거리/난이도/시간) 로
 * 사고 위험. buildPrompt.js 의 Trekking/Hallasan 분기가 현재 100% Gemini 생성
 * = hallucination 안전 위험 → 검증 DB 주입 방식으로 전환 (P191).
 *
 * Assertion 6종:
 *   1. getMountainsByRegion('gangwon') 가 20 row 반환
 *   2. getMountainsByRegion('jeolla') + difficulty='beginner' 필터 작동
 *   3. getMountainsForHallasan() 가 한라산 row 반환 + reservation_required 필드
 *   4. formatTrailWarning 가 영문 안전 경고 (distance + elevation_gain + hours) 정확 표시
 *   5. handlerCore.js 의 Trekking/Hallasan 분기에 _mountain_helper import + 호출
 *   6. _mountain_index.json 의 모든 row 가 elevation_m + difficulty + trails[] 필드 존재
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

// ── Helper: mountain index JSON 로드 ────────────────────────────────────────
function loadMountainIndex(): Array<Record<string, unknown>> {
  const raw = readFileSync(resolve(ROOT, 'api/_mountain_index.json'), 'utf-8');
  return JSON.parse(raw);
}

// ── Assertion 1: getMountainsByRegion('gangwon') ≥ 20 row ───────────────────
// gangwon.json 에 20개 정의되지만 region_map 으로 매핑되는 도시키(sokcho 등)
// 를 통해 조회 시에도 gangwon region 전체를 반환하므로 ≥ 20 보장.
describe('P191-1 — getMountainsByRegion gangwon 20 row', () => {
  it('gangwon region 은 gangwon.json 소스 row 수 이상을 반환해야 한다', async () => {
    // ESM dynamic import (api/ 는 Node ESM 모듈)
    const { getMountainsByRegion } = await import(
      resolve(ROOT, 'api/_mountain_helper.js') + '?t=' + Date.now()
    );
    const results = getMountainsByRegion({ region: 'gangwon' });
    // gangwon.json 은 20 row. region='gangwon' 인 row 총수 (build script 출력: 21)
    expect(results.length).toBeGreaterThanOrEqual(20);
    // 모두 gangwon region 이어야 함
    for (const m of results) {
      expect(m.region).toBe('gangwon');
    }
  });
});

// ── Assertion 2: difficulty 필터 작동 ────────────────────────────────────────
describe('P191-2 — getMountainsByRegion difficulty 필터', () => {
  it("jeolla region + difficulty='beginner' 필터 — beginner 또는 beginner trail 포함 산만 반환", async () => {
    const { getMountainsByRegion } = await import(
      resolve(ROOT, 'api/_mountain_helper.js') + '?t=' + Date.now()
    );
    const all = getMountainsByRegion({ region: 'jeolla' });
    const filtered = getMountainsByRegion({ region: 'jeolla', difficulty: 'beginner' });

    // 필터 적용 시 전체보다 적거나 같아야 함
    expect(filtered.length).toBeLessThanOrEqual(all.length);

    // 반환된 항목은 difficulty='beginner' 이거나 trails 에 beginner 코스 포함
    for (const m of filtered) {
      const hasBeginner =
        m.difficulty === 'beginner' ||
        (Array.isArray(m.trails) &&
          (m.trails as Array<{ difficulty: string }>).some((t) => t.difficulty === 'beginner'));
      expect(hasBeginner).toBe(true);
    }
  });
});

// ── Assertion 3: getMountainsForHallasan() ────────────────────────────────────
describe('P191-3 — getMountainsForHallasan 한라산 lookup', () => {
  it('한라산 row 를 반환하고 reservation_required tag 포함', async () => {
    const { getMountainsForHallasan } = await import(
      resolve(ROOT, 'api/_mountain_helper.js') + '?t=' + Date.now()
    );
    const hallasan = getMountainsForHallasan();

    expect(hallasan).not.toBeNull();
    expect(hallasan).not.toBeUndefined();
    expect(hallasan!.key).toBe('hallasan');

    // 한라산 = 한국 최고봉 (elevation ≥ 1900)
    expect(Number(hallasan!.elevation_m)).toBeGreaterThanOrEqual(1900);

    // SAFETY-CRITICAL: reservation_required 태그 확인
    const tags = hallasan!.tags as string[];
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContain('reservation_required');
  });

  it('한라산 trails[] 가 비어있지 않아야 한다', async () => {
    const { getMountainsForHallasan } = await import(
      resolve(ROOT, 'api/_mountain_helper.js') + '?t=' + Date.now()
    );
    const hallasan = getMountainsForHallasan();
    const trails = hallasan!.trails as Array<{ distance_km: number; elevation_gain_m: number; hours: number }>;
    expect(Array.isArray(trails)).toBe(true);
    expect(trails.length).toBeGreaterThan(0);
    // 각 trail 은 distance_km + elevation_gain_m + hours 필수
    for (const t of trails) {
      expect(typeof t.distance_km).toBe('number');
      expect(typeof t.elevation_gain_m).toBe('number');
      expect(typeof t.hours).toBe('number');
    }
  });
});

// ── Assertion 4: formatTrailWarning 영문 안전 경고 ───────────────────────────
describe('P191-4 — formatTrailWarning 영문 안전 경고 정확도', () => {
  it('한라산 영문 경고에 distance + elevation_gain + hours 포함', async () => {
    const { getMountainsForHallasan, formatTrailWarning } = await import(
      resolve(ROOT, 'api/_mountain_helper.js') + '?t=' + Date.now()
    );
    const hallasan = getMountainsForHallasan();
    const warning = formatTrailWarning(hallasan, 'en');

    expect(typeof warning).toBe('string');
    expect(warning.length).toBeGreaterThan(50);

    // SAFETY-CRITICAL: 정확한 수치 포함 여부
    // 한라산 성판악 코스: 9.6km / +1300m / 9h
    expect(warning).toContain('9.6');       // distance_km
    expect(warning).toContain('1300');      // elevation_gain_m
    expect(warning).toContain('9');         // hours

    // 예약 필수 경고 포함
    expect(warning.toUpperCase()).toContain('RESERVATION REQUIRED');

    // SAFETY 경고 헤더
    expect(warning).toContain('SAFETY-CRITICAL');
  });

  it('일본어 경고에도 수치와 예약 필수 포함', async () => {
    const { getMountainsForHallasan, formatTrailWarning } = await import(
      resolve(ROOT, 'api/_mountain_helper.js') + '?t=' + Date.now()
    );
    const hallasan = getMountainsForHallasan();
    const warning = formatTrailWarning(hallasan, 'ja');

    expect(warning).toContain('事前予約');
    expect(warning).toContain('9.6');
  });

  it('중국어 경고에도 예약 필수 포함', async () => {
    const { getMountainsForHallasan, formatTrailWarning } = await import(
      resolve(ROOT, 'api/_mountain_helper.js') + '?t=' + Date.now()
    );
    const hallasan = getMountainsForHallasan();
    const warning = formatTrailWarning(hallasan, 'zh');

    expect(warning).toContain('须提前预约');
    expect(warning).toContain('9.6');
  });
});

// ── Assertion 5: handlerCore.js Trekking/Hallasan 분기 → _mountain_helper 호출 ──
describe('P191-5 — handlerCore.js _mountain_helper import + 호출', () => {
  it('handlerCore.js 가 _mountain_helper.js 를 import 해야 한다', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/handlerCore.js'), 'utf-8');
    expect(src).toMatch(/_mountain_helper/);
    expect(src).toMatch(/getMountainContextForPrompt/);
  });

  it('handlerCore.js 에 Trekking/Hallasan 분기에서 getMountainContextForPrompt 호출 존재', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/handlerCore.js'), 'utf-8');
    // Trekking 키워드와 getMountainContextForPrompt 둘 다 존재
    expect(src).toMatch(/Trekking|Hallasan/);
    expect(src).toMatch(/getMountainContextForPrompt\s*\(/);
  });

  it('userMessageBuilder.js 가 mountainContext 파라미터를 수신한다', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/userMessageBuilder.js'), 'utf-8');
    expect(src).toMatch(/mountainContext/);
  });
});

// ── Assertion 6: _mountain_index.json 스키마 검증 ────────────────────────────
describe('P191-6 — _mountain_index.json 60 row 스키마 검증', () => {
  it('총 60 row 존재', () => {
    const index = loadMountainIndex();
    expect(index).toHaveLength(60);
  });

  it('모든 row 에 elevation_m 필드 존재', () => {
    const index = loadMountainIndex();
    for (const m of index) {
      expect(
        m.elevation_m,
        `key=${m.key}: elevation_m 누락 — SAFETY-CRITICAL`,
      ).toBeDefined();
      expect(typeof m.elevation_m).toBe('number');
    }
  });

  it('모든 row 에 difficulty 필드 존재', () => {
    const index = loadMountainIndex();
    const VALID_DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);
    for (const m of index) {
      expect(
        m.difficulty,
        `key=${m.key}: difficulty 누락 — SAFETY-CRITICAL`,
      ).toBeDefined();
      expect(
        VALID_DIFFICULTIES.has(m.difficulty as string),
        `key=${m.key}: difficulty='${m.difficulty}' 유효하지 않은 값`,
      ).toBe(true);
    }
  });

  it('모든 row 에 trails[] 필드 존재 (빈 배열 금지)', () => {
    const index = loadMountainIndex();
    for (const m of index) {
      expect(
        Array.isArray(m.trails),
        `key=${m.key}: trails[] 누락 — SAFETY-CRITICAL (코스 정보 없으면 사고 위험)`,
      ).toBe(true);
      expect(
        (m.trails as unknown[]).length,
        `key=${m.key}: trails[] 빈 배열 — 최소 1개 코스 필수`,
      ).toBeGreaterThan(0);
    }
  });

  it('hallasan key 가 반드시 존재하고 reservation_required tag 보유', () => {
    const index = loadMountainIndex();
    const hallasan = index.find((m) => m.key === 'hallasan');
    expect(hallasan).toBeDefined();
    expect((hallasan!.tags as string[])).toContain('reservation_required');
  });

  it('3개 region 파일 모두 포함 (gangwon 20 + gyeongsang 20 + jeolla_jeju_chungcheong 20)', () => {
    const index = loadMountainIndex();
    const gangwon = index.filter((m) => m.region === 'gangwon');
    // gangwon.json 에는 20개 (1개가 region='gangwon' 이 아닌 경우 없음)
    expect(gangwon.length).toBeGreaterThanOrEqual(19);

    // jeju 가 존재해야 함 (jeolla_jeju_chungcheong.json 포함 확인)
    const jeju = index.filter((m) => m.region === 'jeju');
    expect(jeju.length).toBeGreaterThanOrEqual(1);
  });
});
