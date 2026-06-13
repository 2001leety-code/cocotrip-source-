/**
 * SAFE-1/SAFE-4 회귀 (2026-06-13 버그헌트, SAFETY).
 * SAFE-1: 다도시 block_mode 가 matched.dietary_tags(배열)만 읽어 prod(r.tag=문자열)에서
 *   undefined → halal/vegan 검증태그 미전파. fix: 단도시와 동일 dietaryTagsOf(matched).
 * SAFE-4: 출국/도착 터미널 mismatch(비행기 놓침 risk)가 quality_warning(수동패널)만 →
 *   throttledTelegramAlert 추가로 운영자 능동 통지.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const blockSrc = readFileSync(resolve(process.cwd(), 'api/_ai_core/blockMode.js'), 'utf8');
const routeSrc = readFileSync(resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'), 'utf8');

describe('SAFE-1 — 다도시 block_mode 식이태그 전파 (dietaryTagsOf)', () => {
  it('matched.dietary_tags 직접 slice 제거 (prod 미전파 버그)', () => {
    expect(blockSrc).not.toMatch(/dietaryTags\s*=\s*matched\.dietary_tags\.slice\(\)/);
  });
  it('dietaryTagsOf(matched) 사용처 2곳 이상 (단도시 + 다도시)', () => {
    const count = (blockSrc.match(/dietaryTagsOf\(matched\)/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe('블록모드 알레르겐 게이트 — dbMatcher 정합 (2026-06-13, 데이터 retrofit 대비)', () => {
  it('matchFoodPlaceholder safetyCandidates 가 선택 알레르겐 식당 제외', () => {
    // 한국에 식당 알레르겐 API 데이터 부재 → 자동 retrofit 불가, 수동 큐레이션만.
    // block_mode 식당매칭은 allergyPrefs 미적용 gap 이었음(dbMatcher 만 차단) → 게이트 추가.
    expect(blockSrc).toMatch(/allergenSel\s*=\s*dietary\.filter/);
    expect(blockSrc).toMatch(/r\.allergens\[a\]\s*===\s*true/);
  });
});

describe('SAFE-4 — 출국/도착 터미널 mismatch telegram 알림', () => {
  it('departure/arrival mismatch 가 throttledTelegramAlert 발화', () => {
    expect(routeSrc).toMatch(/throttledTelegramAlert\(\{[\s\S]{0,80}departure-terminal-mismatch:/);
    expect(routeSrc).toMatch(/throttledTelegramAlert\(\{[\s\S]{0,80}arrival-terminal-mismatch:/);
  });
});
