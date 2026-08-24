/**
 * `?prefillRegions=` 허용키 검증 (PR #1272 Codex 독립검수 P2-3, 2026-08-10).
 *
 * 이 PR 이 홈 도시 칩을 살리면서 `/planner?prefillRegions=<key>` 를 revision 밖에서도
 * 읽게 만들었다. 그런데 읽기만 하고 **거르지 않아서**, 아무나 만들 수 있는 공개 링크의
 * 임의 문자열이 그대로 WizardForm 의 `initialValues.regions` 로 들어갔다.
 * WizardForm 은 칩에 없는 값을 만나면 그 문자열을 그대로 도시 이름 자리에 표시한다
 * (`src/components/WizardForm/index.tsx` — chip 매칭 실패 시 `setMainCity(r0)`).
 *
 * 계약:
 *   - 위저드가 실제로 그리는 도시 키만 통과한다.
 *   - 모르는 키는 조용히 버린다(에러 화면 X — 링크가 깨졌다고 여행을 막을 이유는 없다).
 *   - revision 흐름은 건드리지 않는다. RevisionCard 는 저장된 plan.input.regions 를
 *     직렬화하는데, 거기에는 현지어 도시명이나 칩에 없는 자유 입력 도시가 정상적으로
 *     들어 있다. 여기서 걸러 버리면 "다시 만들기" 의 도시 prefill 이 사라진다.
 *
 * 순수 모듈로 검증하는 이유: 허용키의 진짜 출처인 `WizardForm/data.tsx` 는 JSX 아이콘
 * 때문에 React + lucide-react 를 끌고 오고, PlannerPage 는 firebase 를 끌고 온다.
 * 둘 다 node 환경 테스트에서 열 수 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CITY_KEYS, filterSupportedRegions } from '../../src/components/WizardForm/cityKeys';
import { HOME_CITIES } from '../../src/sections/home/homeCopy';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('CITY_KEYS — CITY_CHIPS 와 어긋나면 실패한다', () => {
  it('data.tsx 의 CITY_CHIPS 키 목록과 순서까지 같다', () => {
    // Source-text parse: importing data.tsx would pull lucide-react + React into
    // a node-environment test for ten string literals. Same approach
    // scripts/lint-catalog-sync.mjs already uses on this constant.
    const src = read('src/components/WizardForm/data.tsx');
    const block = src.slice(src.indexOf('CITY_CHIPS'), src.indexOf('CITY_PHOTO'));
    const chips = [...block.matchAll(/key:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(chips.length).toBeGreaterThanOrEqual(10);
    expect([...CITY_KEYS]).toEqual(chips);
  });
});

describe('filterSupportedRegions — 공개 쿼리 허용키 검증', () => {
  it('홈 도시 칩의 딥링크는 전부 그대로 통과한다', () => {
    for (const city of HOME_CITIES) {
      expect(filterSupportedRegions(city.key), city.key).toEqual([city.key]);
    }
  });

  it('여러 도시 딥링크는 순서를 지켜 통과한다', () => {
    expect(filterSupportedRegions('seoul,busan,jeju')).toEqual(['seoul', 'busan', 'jeju']);
  });

  it('대소문자·공백은 정규화한다 (링크를 손으로 쓴 경우)', () => {
    expect(filterSupportedRegions(' Seoul , BUSAN ')).toEqual(['seoul', 'busan']);
  });

  it('중복은 한 번만 남긴다', () => {
    expect(filterSupportedRegions('seoul,seoul,busan')).toEqual(['seoul', 'busan']);
  });

  it.each([
    ['모르는 도시', 'pyongyang'],
    ['스크립트 주입', '<script>alert(1)</script>'],
    ['경로 탈출', '../../etc/passwd'],
    ['빈 값', ''],
    ['콤마만', ',,,'],
    ['공백만', '   '],
    ['긴 쓰레기 문자열', 'x'.repeat(300)],
    ['칩 키의 부분 문자열', 'seo'],
    ['칩 키에 꼬리표', 'seoul-attack'],
    ['현지어 도시명 (revision 전용 형식)', '서울'],
  ])('조작 URL 은 무시한다 — %s', (_label, raw) => {
    expect(filterSupportedRegions(raw)).toEqual([]);
  });

  it('유효 키와 조작 값이 섞이면 유효 키만 남는다', () => {
    expect(filterSupportedRegions('seoul,<img onerror=1>,busan,pyongyang')).toEqual(['seoul', 'busan']);
  });

  it('null/undefined 는 빈 배열이다', () => {
    expect(filterSupportedRegions(null)).toEqual([]);
    expect(filterSupportedRegions(undefined)).toEqual([]);
  });
});

describe('PlannerPage 배선 — 공개 딥링크만 거르고 revision 계약은 그대로', () => {
  const planner = read('src/pages/PlannerPage/index.tsx');
  const revisionBlock = planner.slice(
    planner.indexOf('validRevisionContext ? {'),
    planner.indexOf('} : ('),
  );

  it('공개 딥링크는 filterSupportedRegions 를 통과한 값만 쓴다', () => {
    expect(planner).toMatch(/filterSupportedRegions.*from '@\/components\/WizardForm\/cityKeys'/);
    expect(planner).toMatch(/const deepLinkRegions\s*=\s*filterSupportedRegions\(/);
    // 기존 계약(칩 딥링크가 위저드를 실제로 prefill 한다)도 그대로 유지된다.
    expect(planner).toMatch(/deepLinkRegions\.length\s*\?\s*\{\s*regions:\s*deepLinkRegions\s*\}/);
  });

  it('revision 흐름은 거르지 않은 원본 목록을 계속 넘긴다', () => {
    expect(revisionBlock.length).toBeGreaterThan(50);
    expect(revisionBlock, 'revision prefill got filtered — 자유 입력 도시가 사라진다')
      .not.toMatch(/deepLinkRegions/);
    expect(revisionBlock).toMatch(/regions:\s*revisionRegions/);
  });
});
