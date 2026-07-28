/**
 * 회귀 잠금 (2026-07-28) — 내 플랜·예약 사용성.
 *
 * 실측 문제:
 *  · 내 플랜 394개를 limit 없이 전량 구독·렌더 → 모바일 문서 높이 46,589px
 *  · 검색·필터·페이지 나누기 없음
 *  · 지난 예약이 "0.0시간 후" 로 표시
 *  · 날짜 없는 디지털 상품(AI 플래너)에도 카운트다운이 붙음
 *  · AI 예약의 "플랜 보기" 가 해당 플랜이 아니라 /my-plans 목록으로 이동
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('내 플랜 — 전량 렌더 금지', () => {
  const code = codeOf('src/pages/MyPlansPage.tsx');

  it('Firestore 쿼리에 limit 이 걸려 있다', () => {
    expect(code).toContain('limit(pageSize)');
    // orderBy 만 있고 limit 이 없던 구조로 되돌아가면 실패한다.
    const q = code.slice(code.indexOf('query('), code.indexOf('query(') + 260);
    expect(q).toContain('limit(');
  });

  it('첫 조회가 20~30개 범위다', () => {
    const m = code.match(/PAGE_SIZE\s*=\s*(\d+)/);
    expect(m, 'PAGE_SIZE 상수가 없다').not.toBeNull();
    const size = Number(m![1]);
    expect(size).toBeGreaterThanOrEqual(20);
    expect(size).toBeLessThanOrEqual(30);
  });

  it('검색과 더 보기가 있다', () => {
    expect(code).toContain('visiblePlans');
    expect(code).toContain('myPlansLoadMore');
    expect(code).toContain('type="search"');
  });

  it('상태·빈 화면 문구가 번역을 탄다 (영어 하드코딩 제거)', () => {
    expect(code).not.toContain("'✓ Ready'");
    expect(code).not.toContain('No plans yet<');
    expect(code).toContain('myPlansStatusReady');
    expect(code).toContain('myPlansEmptyTitle');
  });
});

describe('예약 카드 — 남은 시간·플랜 링크', () => {
  const code = codeOf('src/components/MyBookingsTab.tsx');

  it('미래 일정에만 카운트다운을 표시한다', () => {
    expect(code).toContain('hoursUntilTour > 0');
  });

  it('지난 일정은 별도 라벨로 표시한다', () => {
    expect(code).toContain('hoursUntilTour <= 0');
    expect(code).toContain('mbPastTour');
  });

  it('날짜 없는 디지털 상품에는 시간 문구를 붙이지 않는다', () => {
    // 두 분기 모두 b.tourDate 를 조건에 포함해야 한다.
    const countdownBlocks = code.split('hoursUntilTour').slice(1, 4).join('');
    expect(countdownBlocks).toContain('b.tourDate');
  });

  it('AI 예약은 해당 planId 상세로 이동한다', () => {
    expect(code).toContain('/my-plans/${b.planId}');
    // planId 가 없을 때만 목록 폴백.
    expect(code).toContain("b.planId ?");
  });
});

describe('서버 — planId 전달', () => {
  const code = codeOf('api/my-bookings.js');

  it('AI 플래너 예약에 planId 를 실어 보낸다', () => {
    expect(code).toContain('plan_issued_orders');
    expect(code).toContain('planId: planIdByBookingId.get(doc.id)');
  });

  it('조회 실패해도 예약 목록은 계속 뜬다 (fail-soft)', () => {
    const block = code.slice(code.indexOf('planIdByBookingId'), code.indexOf('const now = new Date()'));
    expect(block).toContain('catch');
  });

  it('AI 플래너가 아닌 예약에는 추가 조회를 하지 않는다', () => {
    expect(code).toContain("startsWith('ai-planner')");
  });
});

describe('4개 국어 키', () => {
  it('신규 문구가 모든 언어에 있다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const dict = read(`src/i18n/locales/${lang}.json`);
      for (const key of ['myPlansSearch', 'myPlansLoadMore', 'myPlansStatusReady', 'mbPastTour']) {
        expect(dict, `${lang}.json 에 ${key} 없음`).toContain(`"${key}"`);
      }
    }
  });
});
