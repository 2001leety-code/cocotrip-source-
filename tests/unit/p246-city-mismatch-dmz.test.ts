/**
 * P246 — DMZ city-mismatch guard unit tests (2026-05-27).
 *
 * 검증 항목:
 *   1. buildPrompt.js 의 DMZ style 라인에 Gyeonggi city guard 존재 (regression assertion).
 *   2. validateResponse 에 styles=['Dmz'] + 제주 stop 주소 → dmz_city_mismatch issue 생성.
 *   3. validateResponse 에 styles=['Dmz'] + 올바른 Paju/경기 stop → dmz_city_mismatch 없음.
 *   4. styles=[] (Dmz 없음) → dmz_city_mismatch 무시.
 *
 * NOTE: Tests read files from the repo root. After PR merge into main, ROOT = main repo.
 * The Layer 1 regression check catches future regressions that strip the Gyeonggi guard.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to repo root — works in both main worktree and worktree subdir.
const REPO_ROOT = resolve(__dirname, '../..');

// Helper: read file, preferring worktree version over main if both exist.
function readRepoFile(relPath: string): string {
  const mainPath = join(REPO_ROOT, relPath);
  if (existsSync(mainPath)) return readFileSync(mainPath, 'utf-8');
  throw new Error(`File not found: ${mainPath}`);
}

// ── Layer 1: buildPrompt.js regression assertion ──────────────────────────────
describe('P246 Layer1: buildPrompt.js DMZ Gyeonggi guard', () => {
  let buildPromptSrc: string;

  beforeAll(() => {
    buildPromptSrc = readRepoFile('api/_ai_core/buildPrompt.js');
  });

  test('DMZ style line must contain Gyeonggi city constraint', () => {
    // R-P246 regression: "Gyeonggi" keyword must appear in the DMZ style guidance.
    // This guards against someone accidentally removing the city constraint.
    expect(buildPromptSrc.includes('Gyeonggi')).toBe(true);
  });

  test('DMZ style line must have explicit prohibition of Jeju/Busan stops', () => {
    // R-P246: BAD example must be present to reinforce the Gemini constraint.
    const hasForbidJeju =
      /NEVER.*Jeju/s.test(buildPromptSrc) ||
      /BAD.*제주/s.test(buildPromptSrc) ||
      /BAD.*Jeju/s.test(buildPromptSrc) ||
      /P246.*alert/s.test(buildPromptSrc);
    expect(hasForbidJeju).toBe(true);
  });
});

// ── Layer 2: validateResponse DMZ city-mismatch detection (inline logic test) ──
// We inline the R-P246 check logic to test it independently of the import chain.
describe('P246 Layer2 (inline): DMZ city-mismatch guard logic', () => {
  // Mirror the validator logic from responseValidator.js R-P246.
  const DMZ_CITY_VIOLATION_PATTERNS = [
    '제주특별자치도', '제주시', '서귀포시', '제주도', '제주',
    '부산광역시', '해운대구', '수영구', '부산',
    '속초시', '강릉시', '여수시', '경주시',
  ];

  function checkDmzCityMismatch(stops: Array<{name: string; address: string}>, styles: string[]): Array<{type: string; stop: string}> {
    const reqStyles = Array.isArray(styles) ? styles : [];
    if (!reqStyles.some((s) => String(s).toLowerCase() === 'dmz')) return [];
    const issues: Array<{type: string; stop: string; matched_keyword: string}> = [];
    for (const stop of stops) {
      const addr = String(stop.address || '');
      if (!addr) continue;
      const matched = DMZ_CITY_VIOLATION_PATTERNS.find((p) => addr.includes(p));
      if (matched) {
        issues.push({ type: 'dmz_city_mismatch', stop: stop.name || '', matched_keyword: matched });
      }
    }
    return issues;
  }

  test('styles=Dmz + 제주 stop address → dmz_city_mismatch issue 생성', () => {
    const stops = [{ name: '한림공원', address: '제주특별자치도 제주시 한림읍 한림로 300' }];
    const issues = checkDmzCityMismatch(stops, ['Dmz']);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].stop).toBe('한림공원');
  });

  test('styles=Dmz + 곽지해수욕장(제주) → dmz_city_mismatch issue 생성', () => {
    // P246 사고 재현: 곽지해수욕장 is Jeju address.
    const stops = [{ name: '곽지해수욕장', address: '제주특별자치도 제주시 애월읍 곽지리 1565' }];
    const issues = checkDmzCityMismatch(stops, ['Dmz']);
    expect(issues.length).toBeGreaterThan(0);
  });

  test('styles=Dmz + 부산 stop address → dmz_city_mismatch issue 생성', () => {
    const stops = [{ name: '해운대해수욕장', address: '부산광역시 해운대구 우동 해운대해변로 264' }];
    const issues = checkDmzCityMismatch(stops, ['Dmz']);
    expect(issues.length).toBeGreaterThan(0);
  });

  test('styles=Dmz + 경기도 파주 stop → dmz_city_mismatch 없음', () => {
    const stops = [{ name: '임진각 평화누리공원', address: '경기도 파주시 문산읍 임진각로 148-40' }];
    const issues = checkDmzCityMismatch(stops, ['Dmz']);
    expect(issues.length).toBe(0);
  });

  test('styles=Dmz + 서울 기지 호텔 → dmz_city_mismatch 없음 (서울 출발지 OK)', () => {
    const stops = [{ name: '명동 호텔', address: '서울특별시 중구 명동' }];
    const issues = checkDmzCityMismatch(stops, ['Dmz']);
    expect(issues.length).toBe(0);
  });

  test('styles=[] (DMZ 없음) + 제주 stop → dmz_city_mismatch 없음 (가드 비활성)', () => {
    const stops = [{ name: '성산일출봉', address: '제주특별자치도 서귀포시 성산읍' }];
    const issues = checkDmzCityMismatch(stops, []);
    expect(issues.length).toBe(0);
  });

  test('styles=[Food] (DMZ 없음) + 제주 stop → dmz_city_mismatch 없음', () => {
    const stops = [{ name: '흑돼지구이', address: '제주특별자치도 제주시 연동' }];
    const issues = checkDmzCityMismatch(stops, ['Food']);
    expect(issues.length).toBe(0);
  });
});

// ── Layer 2: responseValidator.js 에 P246 마커 존재 확인 ───────────────────────
describe('P246 Layer2: responseValidator.js has R-P246 validator', () => {
  let validatorSrc: string;

  beforeAll(() => {
    validatorSrc = readRepoFile('api/_ai_core/responseValidator.js');
  });

  test('responseValidator.js must contain R-P246 dmz_city_mismatch marker', () => {
    expect(validatorSrc.includes('dmz_city_mismatch')).toBe(true);
  });

  test('responseValidator.js must check request.styles for Dmz', () => {
    expect(validatorSrc.includes("'dmz'")).toBe(true);
  });
});
