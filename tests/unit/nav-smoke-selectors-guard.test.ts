/**
 * SPA 내비 스모크(tests/e2e/nav-link-transitions.spec.ts) 선택자 잠금 (2026-08-21).
 *
 * 사고: Daily Health Check 의 "E2E PROD nav smoke" 가 8/12~8/21 5회 연속 빨강.
 * 코드가 고장난 게 아니라 **스펙이 화면을 잘못 짚고 있었다** — 세 가지 결함:
 *
 *  (1) 번역 문구 의존 — `/tours` 도착 판정을 h1/h2 안의 영어 단어 "Tours" 로 했다.
 *      #1283 계열 에디토리얼 개편에서 h1 이 `tl.pageTitle`("Choose the way you
 *      travel Korea" 등 4언어)로 바뀌자 어느 언어에도 "Tours" 가 없어 영구 실패.
 *  (2) 죽은 CSS 클래스 — 가이드 본문 판정을 `.guide-article` 로 했다. #1277
 *      에디토리얼 전환에서 본문 클래스가 `.ec-prose` 로 갈아끼워져 영구 실패.
 *      (스타일 클래스는 테스트 계약이 아니다 — 디자인 개편마다 조용히 끊긴다.)
 *  (3) 항상 참인 단언 — 투어 상세 전환을 "'Tours' 헤딩이 0개" 로 판정했다.
 *      (1) 때문에 그 헤딩은 **목록 화면에도 원래 0개**라, 내비가 완전히 죽어도
 *      초록이었다. 거짓 초록은 검사가 없는 것보다 나쁘다.
 *
 * 이 파일은 같은 계열 재발을 **PR 시점에** 잡는다. 스펙은 운영(prod)만 때리는
 * 야간 크론이라, 여기서 안 잡히면 5일 뒤 밤에야 드러난다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const SPEC_PATH = 'tests/e2e/nav-link-transitions.spec.ts';
const rawSpec = readFileSync(join(root, SPEC_PATH), 'utf8');

/** 주석은 사건 경위를 적는 곳이라 금지 토큰이 나올 수 있다 — 코드만 검사한다. */
const specCode = rawSpec
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** src 전체에서 리터럴 data-testid 를 수집한다(동적 보간 testid 는 제외). */
function collectSrcTestIds(): Set<string> {
  const ids = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/data-testid=(?:"([^"]+)"|'([^']+)'|\{"([^"]+)"\}|\{'([^']+)'\})/g)) {
        // `||` 사용은 의도적 — pre-commit mojibake 가드가 nullish 연산자 리터럴을
        // 오탐한다. 후보는 정규식 캡처(문자열 또는 undefined)라 결과가 같다.
        const id = match[1] || match[2] || match[3] || match[4];
        if (id) ids.add(id);
      }
    }
  };
  walk(join(root, 'src'));
  return ids;
}

const testIdsInSpec = [...specCode.matchAll(/getByTestId\('([^']+)'\)/g)].map((m) => m[1]);

describe('nav 스모크 스펙 — 화면을 구조로 짚는다', () => {
  it('스펙이 쓰는 data-testid 는 전부 src 에 실제로 존재한다', () => {
    const srcIds = collectSrcTestIds();
    expect(testIdsInSpec.length).toBeGreaterThan(0);
    const missing = testIdsInSpec.filter((id) => !srcIds.has(id));
    expect(missing, `src 에 없는 testid — 스펙이 유령을 기다린다: ${missing.join(', ')}`).toEqual([]);
  });

  it('번역 문구로 화면 전환을 판정하지 않는다', () => {
    // 화면 문구는 4개 언어 × 마케팅 수정마다 바뀐다. 도착 판정의 근거가 될 수 없다.
    expect(specCode).not.toMatch(/hasText/);
  });

  it('CSS 클래스 선택자로 화면 전환을 판정하지 않는다', () => {
    // 스타일 클래스는 디자인 개편에서 이름이 갈린다(.guide-article → .ec-prose).
    const classLocators = [...specCode.matchAll(/locator\(\s*['"`]\s*\.[\w-]/g)].map((m) => m[0]);
    expect(classLocators, `클래스 선택자 사용: ${classLocators.join(', ')}`).toEqual([]);
  });

  it('"사라졌다" 단언은 같은 testid 의 "보인다" 단언과 짝을 이룬다', () => {
    // 짝이 없으면 그 요소는 애초에 한 번도 없었던 것일 수 있다 = 항상 참.
    const disappear = [...specCode.matchAll(/getByTestId\('([^']+)'\)\)\.toHaveCount\(0/g)].map((m) => m[1]);
    expect(disappear.length).toBeGreaterThan(0);
    const unpaired = disappear.filter(
      (id) => !new RegExp(`getByTestId\\('${id}'\\)\\)\\.toBeVisible`).test(specCode),
    );
    expect(unpaired, `사전 존재 확인 없는 소멸 단언(공허하게 통과함): ${unpaired.join(', ')}`).toEqual([]);
  });
});
