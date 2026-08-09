/**
 * #1272 P2 (2026-08-10) — "다크 모드를 검증 중" 이라는 거짓 신호 재발 차단.
 *
 * 사실관계(이 파일이 잠그는 것):
 *   1. 이 앱의 테마 스위치는 `<html>` 의 `dark` 클래스 하나뿐이다 (tailwind darkMode:["class"]).
 *   2. src/main.tsx 가 그 클래스를 **무조건** 붙인다 — 분기·조건 없음.
 *   3. `prefers-color-scheme` 를 읽는 코드는 src/ 전체에 0건이다.
 * → 따라서 Playwright 의 `colorScheme`(= prefers-color-scheme 미디어 특성 에뮬레이션)은
 *   이 앱에서 아무것도 바꾸지 못한다. 실제로 `mobile-375` / `mobile-375-dark` 두 프로젝트가
 *   낸 baseline 4쌍은 전부 SHA1 이 동일했고, CI run 31332692514 의 actual 도 테스트당 1장뿐이었다.
 *   커버리지 0 · CI 시간 2배 · "다크 검사 중" 이라는 거짓 안전감만 남아 프로젝트를 삭제했다.
 *
 * 이 파일이 깨지는 두 경우와 해야 할 일:
 *   (A) 1~3 중 하나가 바뀌었다 = 라이트 모드/테마 전환이 실제로 도입됐다.
 *       → 축하할 일이다. 이 테스트를 새 계약으로 갱신하고, 시각 회귀에 **진짜** 테마
 *         커버리지를 추가한다. 방법은 `colorScheme` 가 아니라 `dark` 클래스 토글
 *         (addInitScript 로 classList.remove/add). 절차: src/index.css 상단 주석 +
 *         docs/DESIGN-LIGHT-MODE-PATH.md.
 *   (B) 테스트 설정/스펙에 다시 `colorScheme` 기반 다크 변종이 생겼다.
 *       → 단일 테마인 동안 그것은 같은 화면을 두 번 찍는 것이다. 되돌릴 것.
 *         다크가 실제로 남아 있는 표면(데스크톱 본문·레거시 페이지)은
 *         docs/DESIGN-EDITORIAL-CONCIERGE.md 마이그레이션 표 참조 — 그 표면을 잡아야
 *         진짜 다크 커버리지가 된다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * 주석 제거 — 이 테스트가 잠그는 것은 "설정 코드" 다. 설명 주석에 `colorScheme: 'dark'`
 * 같은 문자열이 들어 있다고 실패하면(실제로 처음에 그렇게 걸렸다) 오탐이다.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** src/ 전체 소스 파일 수집 (재귀). */
function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(resolve(root, dir))) {
    const rel = join(dir, entry);
    const st = statSync(resolve(root, rel));
    if (st.isDirectory()) collectSources(rel, acc);
    else if (/\.(ts|tsx|css|js|jsx)$/.test(entry)) acc.push(rel);
  }
  return acc;
}

describe('#1272 P2 — 단일 테마 앱이므로 colorScheme 기반 다크 검증은 없다', () => {
  it('src/main.tsx 는 dark 클래스를 무조건 붙인다 (테마 분기 없음)', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/document\.documentElement\.classList\.add\('dark'\)/);
    // 조건부로 바뀌면(라이트 모드 도입) 아래가 걸린다 → 위 (A) 절차.
    expect(main).not.toMatch(/classList\.remove\('dark'\)/);
    expect(main).not.toMatch(/matchMedia\([^)]*prefers-color-scheme/);
  });

  it('tailwind 의 테마 스위치는 class 하나다', () => {
    expect(read('tailwind.config.js')).toMatch(/darkMode:\s*\["class"\]/);
  });

  it('src/ 어디서도 prefers-color-scheme 를 읽지 않는다', () => {
    const offenders = collectSources('src').filter((f) => read(f).includes('prefers-color-scheme'));
    expect(offenders).toEqual([]);
  });

  it('visual 설정에 colorScheme:dark 프로젝트가 없다 (같은 화면 2번 찍기 금지)', () => {
    const cfg = stripComments(read('playwright.visual.config.ts'));
    expect(cfg).not.toMatch(/colorScheme:\s*['"]dark['"]/);
    expect(cfg).not.toMatch(/name:\s*['"][^'"]*-dark['"]/);
  });

  it('e2e 스펙도 colorScheme 로 다크 변종을 만들지 않는다', () => {
    const specs = readdirSync(resolve(root, 'tests/e2e'))
      .filter((f) => f.endsWith('.spec.ts'))
      .filter((f) => /colorScheme:\s*['"]dark['"]/.test(stripComments(read(join('tests/e2e', f)))));
    expect(specs).toEqual([]);
  });

  it('남은 visual baseline 에 -dark- 파일이 없다 (light 와 바이트 동일한 사본)', () => {
    const dirs = readdirSync(resolve(root, 'tests/visual')).filter((d) => d.endsWith('-snapshots'));
    expect(dirs.length).toBeGreaterThan(0); // 스냅샷 디렉토리 자체가 사라지면 그것도 회귀다
    const darkFiles = dirs.flatMap((d) =>
      readdirSync(resolve(root, 'tests/visual', d))
        .filter((f) => f.includes('-dark-'))
        .map((f) => `${d}/${f}`),
    );
    expect(darkFiles).toEqual([]);
  });
});
