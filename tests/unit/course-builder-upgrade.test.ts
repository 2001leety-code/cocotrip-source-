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

  it('유료 Gemini 호출 전 IP rate-limit (비용-DoS 방어, place-search 패턴)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/course-ai.js'), 'utf8');
    expect(src).toMatch(/checkIpRateLimit/);                 // 공용 rate-limit 헬퍼
    expect(src).toMatch(/course_ai_rate_limits/);            // 전용 버킷
    // rate-limit 체크는 반드시 GoogleGenerativeAI(유료) 호출보다 앞에 와야 비용 차단됨
    const rateIdx = src.indexOf('checkIpRateLimit({');
    const geminiIdx = src.indexOf('new GoogleGenerativeAI');
    expect(rateIdx).toBeGreaterThan(0);
    expect(rateIdx).toBeLessThan(geminiIdx);                 // 순서: rate-limit → Gemini
  });
});

describe('course-ai rate-limit degrade 동작', () => {
  it('한도 초과 시 500/429 아니라 nn 폴백으로 degrade (사용자는 순서 받음)', async () => {
    // Firestore 없이(fail-OPEN) 실행되면 rate-limit 통과 → 키 없으면 nn.
    // 여기선 소스 불변식으로 degrade 경로 존재 확인(실 Gemini 호출 없이).
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/course-ai.js'), 'utf8');
    // 한도 초과 분기가 fallbackOrder + rateLimited:true 로 200 반환하는지
    expect(src).toMatch(/if \(!_rate\.ok\)/);
    expect(src).toMatch(/rateLimited: true/);
    // 그 분기 안에서 fallbackOrder 를 쓰는지(throw/500 아님)
    const branch = src.slice(src.indexOf('if (!_rate.ok)'), src.indexOf('if (!_rate.ok)') + 240);
    expect(branch).toMatch(/optimizedOrder: fallbackOrder/);
    expect(branch).not.toMatch(/writeHead\(429|writeHead\(500/);
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

  // 2026-08-10 (Editorial Concierge phase 2): 모드 문구가 `PlannerPage/index.tsx` 안
  // 인라인 `MODE_TEXT` 에서 `PlannerPage/plannerCopy.ts` 로 옮겨갔고, 동시에 기계를
  // 앞세우던 표현("AI가 전부 짜드려요")을 손님이 받는 결과 중심으로 고쳐 썼다.
  // 이 테스트가 지키려던 것은 특정 문장이 아니라 **4언어 동등성**이므로 그대로 지킨다.
  it('PlannerPage 모드선택 4언어 (영어 고정 해소)', async () => {
    const { PLANNER_COPY } = await import('../../src/pages/PlannerPage/plannerCopy');
    for (const lang of ['en', 'ko', 'ja', 'zh'] as const) {
      const m = PLANNER_COPY[lang].modes;
      for (const value of [m.heading, m.guided.title, m.guided.body, m.builder.title, m.builder.body]) {
        expect(typeof value, `${lang}`).toBe('string');
        expect(value.length, `${lang}`).toBeGreaterThan(0);
      }
    }
    // 언어마다 실제로 다른 문장이어야 한다 (영어 복붙 방지 — 이 테스트의 원래 목적).
    const titles = (['en', 'ko', 'ja', 'zh'] as const).map((l) => PLANNER_COPY[l].modes.guided.title);
    expect(new Set(titles).size).toBe(4);
  });
});
