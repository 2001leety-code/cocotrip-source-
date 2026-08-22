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

/**
 * src 에서 testid 를 인정하는 두 가지 표기 — DOM 속성 `data-testid` 와, 컴포넌트가
 * 받아서 그대로 내려보내는 `testId` prop(레포 컨벤션: CommunityLoadingState 등).
 * 홑따옴표·쌍따옴표·백틱을 모두 받고, 보간(`${...}`)이 든 백틱은 리터럴이 아니라 제외한다.
 */
const SRC_TESTID_RE =
  /(?:data-testid|\btestId)=(?:"([^"]+)"|'([^']+)'|\{\s*(?:"([^"]+)"|'([^']+)'|`([^`$]+)`)\s*\})/g;

/** src 전체에서 리터럴 data-testid/testId 를 수집한다(동적 보간 testid 는 제외). */
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
      for (const match of source.matchAll(SRC_TESTID_RE)) {
        // `||` 사용은 의도적 — pre-commit mojibake 가드가 nullish 연산자 리터럴을
        // 오탐한다. 후보는 정규식 캡처(문자열 또는 undefined)라 결과가 같다.
        const id = match[1] || match[2] || match[3] || match[4] || match[5];
        if (id) ids.add(id);
      }
    }
  };
  walk(join(root, 'src'));
  return ids;
}

const testIdsInSpec = [...specCode.matchAll(/getByTestId\(\s*(['"`])([^'"`]+)\1\s*\)/g)].map((m) => m[2]);

const translatedTextSelectors = (code: string) => [
  ...code.matchAll(/\bhasText\s*:/g),
  ...code.matchAll(/:has-text\s*\(/g),
  ...code.matchAll(/\bgetBy(?:Text|AltText|Label|Placeholder|Title)\s*\(/g),
  ...code.matchAll(/\blocator\(\s*['"`]text=/g),
  // 🔴 `[^}]*` 로 **그 호출의 옵션 객체 안**만 본다. 예전 `[\s\S]*?` 판은 닫는 괄호를
  //    넘어 파일 뒤쪽까지 훑어서, 합법적인 `{ level: 1 }` 뒤 아무데나 `name:` 이
  //    있기만 하면 거짓 적발이 났다(실측). role level 단언은 막으면 안 된다.
  ...code.matchAll(/\bgetByRole\s*\(\s*['"`][^'"`]*['"`]\s*,\s*\{[^}]*\bname\s*:/g),
].map((m) => m[0]);

const unpairedDisappearances = (code: string): string[] => {
  const unpaired: string[] = [];
  const blocks = (`\n${code}`).split(/\n\s*test\s*\(/).slice(1);
  for (const block of blocks) {
    // `(?:\s*\.\w+\([^()]*\))*` = `.first()`·`.nth(0)` 같은 체이닝 허용.
    // 없으면 `getByTestId('x').first()).toHaveCount(0)` 형태가 짝 검사에서 통째로
    // 안 보여 공허한 소멸 단언이 다시 새어든다(실측).
    const assertions = [...block.matchAll(
      /getByTestId\(\s*(['"`])([^'"`]+)\1\s*\)(?:\s*\.\w+\([^()]*\))*\s*\)\.(toBeVisible|toHaveCount)\s*\(\s*(0)?/g,
    )];
    for (const assertion of assertions) {
      if (assertion[3] !== 'toHaveCount' || assertion[4] !== '0') continue;
      const id = assertion[2];
      const disappearanceAt = assertion.index || 0;
      const visibleBefore = assertions.some(
        (candidate) => candidate[2] === id && candidate[3] === 'toBeVisible'
          && (candidate.index || 0) < disappearanceAt,
      );
      if (!visibleBefore) unpaired.push(id);
    }
  }
  return unpaired;
};

describe('nav 스모크 스펙 — 화면을 구조로 짚는다', () => {
  it('스펙이 쓰는 data-testid 는 전부 src 에 실제로 존재한다', () => {
    const srcIds = collectSrcTestIds();
    expect(testIdsInSpec.length).toBeGreaterThan(0);
    const missing = testIdsInSpec.filter((id) => !srcIds.has(id));
    expect(missing, `src 에 없는 testid — 스펙이 유령을 기다린다: ${missing.join(', ')}`).toEqual([]);
  });

  it('번역 문구로 화면 전환을 판정하지 않는다', () => {
    // 화면 문구는 4개 언어 × 마케팅 수정마다 바뀐다. 도착 판정의 근거가 될 수 없다.
    const selectors = translatedTextSelectors(specCode);
    expect(selectors, `문구 기반 선택자 사용: ${selectors.join(', ')}`).toEqual([]);
  });

  it('CSS 클래스 선택자로 화면 전환을 판정하지 않는다', () => {
    // 스타일 클래스는 디자인 개편에서 이름이 갈린다(.guide-article → .ec-prose).
    const classLocators = [...specCode.matchAll(/locator\(\s*['"`]\s*\.[\w-]/g)].map((m) => m[0]);
    expect(classLocators, `클래스 선택자 사용: ${classLocators.join(', ')}`).toEqual([]);
  });

  it('"사라졌다" 단언은 같은 testid 의 "보인다" 단언과 짝을 이룬다', () => {
    // 같은 test 안에서 클릭 전 존재를 확인해야 한다. 다른 test 의 확인이나 뒤늦은 확인은 무효다.
    const disappear = [...specCode.matchAll(/\.toHaveCount\s*\(\s*0/g)];
    expect(disappear.length).toBeGreaterThan(0);
    const unpaired = unpairedDisappearances(specCode);
    expect(unpaired, `사전 존재 확인 없는 소멸 단언(공허하게 통과함): ${unpaired.join(', ')}`).toEqual([]);
  });

  it('locale 독립 h1 신호가 살아 있다', () => {
    // testid 는 <div> 에 붙여도 통과한다 — 제목이 <h1> 에서 <div> 로 강등되는 회귀는
    // role+level 로만 잡힌다. 문구를 안 보므로 4개 언어에 무관하다.
    expect(specCode).toMatch(/getByRole\(\s*['"`]heading['"`]\s*,\s*\{[^}]*\blevel\s*:\s*1/);
  });

  it('짝 검사는 다른 test 또는 소멸 뒤의 존재 확인을 빌려 통과하지 않는다', () => {
    const otherTest = `test('a', async () => { expect(page.getByTestId("shell")).toBeVisible(); });\n`
      + `test('b', async () => { expect(page.getByTestId('shell')).toHaveCount(0); });`;
    const wrongOrder = `test('a', async () => { expect(page.getByTestId(\`shell\`)).toHaveCount(0); `
      + `expect(page.getByTestId(\`shell\`)).toBeVisible(); });`;
    // 체이닝(`.first()`)으로 짝 검사 눈을 피하는 형태도 잡혀야 한다.
    const chained = `test('a', async () => { expect(page.getByTestId('shell').first()).toHaveCount(0); });`;
    expect(unpairedDisappearances(otherTest)).toEqual(['shell']);
    expect(unpairedDisappearances(wrongOrder)).toEqual(['shell']);
    expect(unpairedDisappearances(chained)).toEqual(['shell']);
    // 순서가 맞으면(존재 확인 → 소멸) 통과해야 한다 — 규칙이 과잉이면 안 된다.
    const rightOrder = `test('a', async () => { expect(page.getByTestId('shell')).toBeVisible(); `
      + `expect(page.getByTestId('shell')).toHaveCount(0); });`;
    expect(unpairedDisappearances(rightOrder)).toEqual([]);
  });

  it('주요 문구 선택자 우회 형태를 전부 잡는다', () => {
    const bad = [
      `page.locator('h1:has-text("Tours")')`,
      `page.getByText('Tours')`,
      `page.getByRole('heading', { name: 'Tours' })`,
      `page.locator('article').filter({ hasText: 'Tours' })`,
    ].join('\n');
    expect(translatedTextSelectors(bad)).toHaveLength(4);
    expect(translatedTextSelectors(`page.getByAltText('Tours')`)).toHaveLength(1);
    // 🔴 합법적인 role level 단언은 막지 않는다 — 뒤에 무관한 `name:` 이 있어도 마찬가지.
    //    옛 판은 옵션 객체를 넘어 파일 뒤쪽까지 훑어 여기서 거짓 적발이 났다.
    expect(translatedTextSelectors(`page.getByRole('heading', { level: 1 })`)).toEqual([]);
    expect(translatedTextSelectors(
      `page.getByRole('heading', { level: 1 });\nconst meta = { name: 'unrelated' };`,
    )).toEqual([]);
  });
});
