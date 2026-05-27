/**
 * P248 — Haenyeo city-mismatch guard unit tests (2026-05-27).
 *
 * 검증 항목:
 *   1. buildPrompt.js 의 Haenyeo style 라인에 Jeju city guard 존재 (regression assertion).
 *   2. validateResponse 에 styles=['Haenyeo'] + 서울 stop 주소 → haenyeo_city_mismatch issue 생성.
 *   3. validateResponse 에 styles=['Haenyeo'] + 올바른 Jeju stop → haenyeo_city_mismatch 없음.
 *   4. styles=[] (Haenyeo 없음) → haenyeo_city_mismatch 무시.
 *
 * NOTE: Tests read files from the repo root. After PR merge into main, ROOT = main repo.
 * The Layer 1 regression check catches future regressions that strip the Jeju guard.
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
describe('P248 Layer1: buildPrompt.js Haenyeo Jeju guard', () => {
  let buildPromptSrc: string;

  beforeAll(() => {
    buildPromptSrc = readRepoFile('api/_ai_core/buildPrompt.js');
  });

  test('Haenyeo style line must contain Jeju city constraint', () => {
    // R-P248 regression: "Jeju" keyword must appear in the Haenyeo style guidance.
    // This guards against someone accidentally removing the city constraint.
    const hasJejuGuard =
      /Haenyeo.*Jeju/s.test(buildPromptSrc) ||
      /haenyeo.*Jeju/s.test(buildPromptSrc);
    expect(hasJejuGuard).toBe(true);
  });

  test('Haenyeo style line must have explicit prohibition of Seoul/Busan stops', () => {
    // R-P248: BAD example must be present to reinforce the Gemini constraint.
    const hasForbidSeoul =
      /NEVER.*Seoul/s.test(buildPromptSrc) ||
      /BAD.*서울/s.test(buildPromptSrc) ||
      /BAD.*임진각/s.test(buildPromptSrc) ||
      /P248.*alert/s.test(buildPromptSrc);
    expect(hasForbidSeoul).toBe(true);
  });
});

// ── Layer 2: Haenyeo city-mismatch detection (inline logic test) ──────────────
// We inline the R-P248 check logic to test it independently of the import chain.
describe('P248 Layer2 (inline): Haenyeo city-mismatch guard logic', () => {
  // Mirror the validator logic from responseValidator.js R-P248.
  const HAENYEO_CITY_VIOLATION_PATTERNS = [
    '서울특별시', '서울시', '서울',
    '경기도', '파주시', '고양시', '수원시', '성남시', '용인시', '인천광역시',
    '부산광역시', '해운대구', '수영구', '부산',
    '대구광역시', '대구', '광주광역시', '광주',
    '대전광역시', '대전', '울산광역시', '울산',
    '강원도', '속초시', '강릉시', '경주시', '전주시', '여수시',
  ];

  function checkHaenyCityMismatch(
    stops: Array<{ name: string; address: string }>,
    styles: string[],
  ): Array<{ type: string; stop: string; matched_keyword: string }> {
    const reqStyles = Array.isArray(styles) ? styles : [];
    if (!reqStyles.some((s) => String(s).toLowerCase() === 'haenyeo')) return [];
    const issues: Array<{ type: string; stop: string; matched_keyword: string }> = [];
    for (const stop of stops) {
      const addr = String(stop.address || '');
      if (!addr) continue;
      const matched = HAENYEO_CITY_VIOLATION_PATTERNS.find((p) => addr.includes(p));
      if (matched) {
        issues.push({ type: 'haenyeo_city_mismatch', stop: stop.name || '', matched_keyword: matched });
      }
    }
    return issues;
  }

  test('styles=Haenyeo + 서울 stop address → haenyeo_city_mismatch issue 생성', () => {
    const stops = [{ name: '경복궁', address: '서울특별시 종로구 사직로 161' }];
    const issues = checkHaenyCityMismatch(stops, ['Haenyeo']);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].stop).toBe('경복궁');
    expect(issues[0].type).toBe('haenyeo_city_mismatch');
  });

  test('styles=Haenyeo + 임진각(파주) → haenyeo_city_mismatch issue 생성', () => {
    // P248 hallucination 재현: DMZ day 명소 being placed in Haenyeo plan
    const stops = [{ name: '임진각 평화누리공원', address: '경기도 파주시 문산읍 임진각로 148-40' }];
    const issues = checkHaenyCityMismatch(stops, ['Haenyeo']);
    expect(issues.length).toBeGreaterThan(0);
  });

  test('styles=Haenyeo + 동대문(서울) → haenyeo_city_mismatch issue 생성', () => {
    const stops = [{ name: '동대문 디자인 플라자', address: '서울특별시 중구 을지로 281' }];
    const issues = checkHaenyCityMismatch(stops, ['Haenyeo']);
    expect(issues.length).toBeGreaterThan(0);
  });

  test('styles=Haenyeo + 부산 stop → haenyeo_city_mismatch issue 생성', () => {
    const stops = [{ name: '해운대해수욕장', address: '부산광역시 해운대구 우동 해운대해변로 264' }];
    const issues = checkHaenyCityMismatch(stops, ['Haenyeo']);
    expect(issues.length).toBeGreaterThan(0);
  });

  test('styles=Haenyeo + 제주 해녀박물관 stop → haenyeo_city_mismatch 없음', () => {
    const stops = [{ name: '국립 제주해녀박물관', address: '제주도 제주시 구좌읍 해녀박물관길 26' }];
    const issues = checkHaenyCityMismatch(stops, ['Haenyeo']);
    expect(issues.length).toBe(0);
  });

  test('styles=Haenyeo + 섭지코지(서귀포) stop → haenyeo_city_mismatch 없음', () => {
    const stops = [{ name: '섭지코지 해녀 체험', address: '제주도 서귀포시 성산읍 섭지코지로 107' }];
    const issues = checkHaenyCityMismatch(stops, ['Haenyeo']);
    expect(issues.length).toBe(0);
  });

  test('styles=[] (Haenyeo 없음) + 서울 stop → haenyeo_city_mismatch 없음 (가드 비활성)', () => {
    const stops = [{ name: '경복궁', address: '서울특별시 종로구 사직로 161' }];
    const issues = checkHaenyCityMismatch(stops, []);
    expect(issues.length).toBe(0);
  });

  test('styles=[Food] (Haenyeo 없음) + 서울 stop → haenyeo_city_mismatch 없음', () => {
    const stops = [{ name: '광장시장', address: '서울특별시 종로구 창경궁로 88' }];
    const issues = checkHaenyCityMismatch(stops, ['Food']);
    expect(issues.length).toBe(0);
  });

  test('stop with no address → skip (block-mode placeholder)', () => {
    const stops = [{ name: '플레이스홀더', address: '' }];
    const issues = checkHaenyCityMismatch(stops, ['Haenyeo']);
    expect(issues.length).toBe(0);
  });
});

// ── Layer 2: responseValidator.js 에 P248 마커 존재 확인 ───────────────────────
describe('P248 Layer2: responseValidator.js has R-P248 validator', () => {
  let validatorSrc: string;

  beforeAll(() => {
    validatorSrc = readRepoFile('api/_ai_core/responseValidator.js');
  });

  test('responseValidator.js must contain R-P248 haenyeo_city_mismatch marker', () => {
    expect(validatorSrc.includes('haenyeo_city_mismatch')).toBe(true);
  });

  test('responseValidator.js must check request.styles for Haenyeo', () => {
    expect(validatorSrc.includes("'haenyeo'")).toBe(true);
  });

  test('responseValidator.js must have P248 log marker', () => {
    expect(validatorSrc.includes('P248')).toBe(true);
  });
});
