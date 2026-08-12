/**
 * 회귀 잠금 (2026-07-28) — 플랜 상세 탭 빈 공간 + 접근성.
 *
 * 실측 문제:
 *  · 슬라이드를 전부 렌더해 가로로 늘어놓고 부모 높이가 **가장 긴 슬라이드**(3,089px)를
 *    따라갔다 → 짧은 탭에서 아래가 텅 빔(Day1 ~1,464px / Day3 ~1,456px / 여행준비 ~913px).
 *  · 숨은 슬라이드의 버튼·링크에 키보드 초점이 그대로 들어갔다.
 *  · 페이지 헤더와 인트로 슬라이드가 동시에 h1 을 내보내 h1 이 둘이었다.
 *  · 방문지 수에 숙소 출발·복귀가 포함돼 실제보다 많게 표시됐다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { countVisibleStops } from '../../src/pages/PlanDetailPage/lib/planStats';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('SwipeContainer — 선택 탭 높이만 반영', () => {
  const code = codeOf('src/pages/PlanDetailPage/components/SwipeContainer.tsx');

  it('선택 안 된 슬라이드를 접는다 (부모 높이가 최장 슬라이드를 안 따라감)', () => {
    expect(code).toContain('isActive');
    expect(code).toContain('height: 0');
    expect(code).toContain("overflow: 'hidden'");
  });

  it('숨은 슬라이드는 접근성 트리에서 빠지고 초점도 안 들어간다', () => {
    expect(code).toContain('aria-hidden');
    expect(code).toContain('inert={!isActive}');
  });

  it('가로 캐러셀 이동은 유지하되 별도 모션 라이브러리는 쓰지 않는다', () => {
    expect(code).toContain('translateX(-${current * 100}%)');
    expect(code).not.toContain('framer-motion');
  });
});

describe('플랜 상세 — 문서 제목은 하나', () => {
  it('인트로 슬라이드는 문서 제목을 반복하지 않는다', () => {
    const intro = read('src/pages/PlanDetailPage/components/IntroSlide.tsx');
    expect(intro).not.toContain('<h1');
    expect(intro).not.toContain('<h2');
    expect(intro).toContain('<ShareMiniIcon');
  });

  it('페이지 헤더가 유일한 h1 을 가진다 (오류 화면은 조기 반환이라 동시 렌더 없음)', () => {
    const idx = read('src/pages/PlanDetailPage/index.tsx');
    const masthead = read('src/pages/PlanDetailPage/components/PlanDocumentMasthead.tsx');
    expect(idx).toContain('<PlanDocumentMasthead');
    expect(masthead).toContain('<h1');
  });
});

describe('통계 정의', () => {
  const code = codeOf('src/pages/PlanDetailPage/components/PlanDocumentMasthead.tsx');

  it('방문지 수에서 숙소를 제외한다', () => {
    expect(countVisibleStops([{ stops: [{ category: 'lodging' }, { category: 'culture' }] }])).toBe(1);
    expect(code).toContain('countVisibleStops(days)');
  });

  it('헤더 라벨이 번역을 탄다 (영어 하드코딩 제거)', () => {
    for (const bad of ["label: 'Days'", "label: 'Stops'", "label: 'Travelers'", "label: 'Distance'"]) {
      expect(code, `${bad} 하드코딩 잔존`).not.toContain(bad);
    }
    expect(code).toContain('planStatDays');
    expect(code).toContain('planStatStops');
    expect(code).toContain('planStatTravelers');
    expect(code).toContain('documentRouteNote');
  });

  it('4개 국어에 헤더 키가 있다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const dict = read(`src/i18n/locales/${lang}.json`);
      for (const key of ['documentEyebrow', 'documentRouteNote', 'planStatDays', 'planStatStops', 'planStatTravelers']) {
        expect(dict, `${lang}.json 에 ${key} 없음`).toContain(`"${key}"`);
      }
    }
  });
});
