/**
 * 코스빌더 업그레이드 잠금 (2026-07-05):
 * place-search 자동완성·좌표저장·미니지도·AI 동선최적화·제목날짜·로그인CTA·i18n.
 */
import { describe, it, expect } from 'vitest';
import { reorderStops, emptyDraft, addStop, type CourseDraft } from '../../src/pages/PlannerPage/components/courseBuilder/courseOps';

function draftWith(stops: Array<{ title: string; lat?: number; lng?: number }>): CourseDraft {
  let d = emptyDraft(1);
  for (const s of stops) d = addStop(d, 0, { title: s.title, time: '', category: 'sight', memo: '', ...(s.lat != null ? { lat: s.lat, lng: s.lng } : {}) }, 1);
  return d;
}

describe('reorderStops — AI 동선 최적화 순서 적용 (손실 방지)', () => {
  it('주어진 순서로 재정렬', () => {
    const d = draftWith([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    const ids = d.days[0].stops.map((s) => s.id);
    const r = reorderStops(d, 0, [ids[2], ids[0], ids[1]], 2);
    expect(r.days[0].stops.map((s) => s.title)).toEqual(['C', 'A', 'B']);
  });

  it('orderedIds 에 빠진 stop 은 뒤에 보존 (절대 삭제 안 함)', () => {
    const d = draftWith([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    const ids = d.days[0].stops.map((s) => s.id);
    const r = reorderStops(d, 0, [ids[1]], 2); // B만 지정
    expect(r.days[0].stops.map((s) => s.title)).toEqual(['B', 'A', 'C']);
    expect(r.days[0].stops).toHaveLength(3); // 손실 0
  });

  it('없는 id 무시, 순서 동일하면 no-op(참조 유지)', () => {
    const d = draftWith([{ title: 'A' }, { title: 'B' }]);
    const ids = d.days[0].stops.map((s) => s.id);
    expect(reorderStops(d, 0, [...ids], 2)).toBe(d); // 동일 순서 = no-op
    expect(reorderStops(d, 0, ['ghost'], 2).days[0].stops).toHaveLength(2); // 없는 id → 원순서 보존
  });
});

describe('course-ai 배선 불변식', () => {
  it('nearest-neighbor 폴백 + id 정합성 검증 + food_index 미임포트', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/course-ai.js'), 'utf8');
    expect(src).toMatch(/nearestNeighborOrder/);           // 폴백 순수계산
    expect(src).toMatch(/order\.every\(\(id\) => inputIds\.has\(id\)\)/); // id 정합성(손실/추가 방지)
    expect(src).toMatch(/if \(!valid\) order = fallbackOrder/); // 불량 시 폴백
    expect(src).not.toMatch(/(import|require)[^\n]*_food_index/); // CLAUDE.md B-1: 임포트 금지(주석 언급은 허용)
    expect(src).toMatch(/thinkingBudget: 0/);              // 잘림 방지
  });

  it('nearby 좌표 한국범위 + 상한 5 필터', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/course-ai.js'), 'utf8');
    expect(src).toMatch(/n\.lat >= 33 && n\.lat <= 39/);
    expect(src).toMatch(/\.slice\(0, 5\)/);
  });
});

describe('CourseBuilder UI 배선 불변식', () => {
  it('입력창 place-search 자동완성 + 좌표저장(handlePickPlace)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/pages/PlannerPage/components/CourseBuilderShell.tsx'), 'utf8');
    expect(src).toMatch(/CoursePlaceSearch/);
    expect(src).toMatch(/handlePickPlace/);
    expect(src).toMatch(/CourseMiniMap/);          // 미니지도
    expect(src).toMatch(/handleAiOptimize/);       // AI 최적화
    expect(src).toMatch(/reorderStops/);
    expect(src).toMatch(/signInWithGoogle/);       // 로그인 CTA
    expect(src).toMatch(/saveDate/);               // 제목/날짜
    expect(src).not.toMatch(/GripVertical/);       // 드래그 아이콘 제거(오해 방지)
  });

  it('place-search 자동완성 컴포넌트 — 좌표 있는 후보만, place-search API 호출', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/pages/PlannerPage/components/courseBuilder/CoursePlaceSearch.tsx'), 'utf8');
    expect(src).toMatch(/\/api\/place-search/);
    expect(src).toMatch(/Number\.isFinite\(Number\(it\.lat\)\)/);
    expect(src).toMatch(/onEnterFreeText/); // 자유입력 폴백
  });

  it('PlannerPage 모드선택 4언어 (영어 고정 해소)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/pages/PlannerPage/index.tsx'), 'utf8');
    expect(src).toMatch(/AI가 전부 짜드려요/);
    expect(src).toMatch(/自分の場所で作る/);
    expect(src).toMatch(/AI帮你全部规划/);
  });
});
