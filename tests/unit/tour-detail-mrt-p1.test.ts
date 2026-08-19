/**
 * MRT 벤치마킹 P1 — 투어 상세 페이지 grounded 신뢰 배지 + 취소정책 섹션 + sticky anchor 탭
 * (2026-08-19). TourDetailPage 는 Firebase(useTour)를 물고 있어 이 레포의 기존 관례대로
 * (tour-detail-editorial-shell.test.ts, refined-ui-tourdetail.test.ts) 렌더 대신 소스 문자열로
 * 배선을 확인한다. 실제 표 값/문구 렌더 대조는 컴포넌트 단위 테스트
 * (tour-detail-cancellation-section.component.test.tsx, tour-section-tabs.component.test.tsx)에서 한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const page = read('../../src/pages/TourDetailPage.tsx');
const css = read('../../src/styles/editorial-tour-detail.css');
const copy = read('../../src/pages/tourDetailEditorialCopy.ts');

describe('앵커 배선 — 섹션 id + sticky 탭 + scroll-margin', () => {
  it('7개 섹션 타깃에 앵커 id 가 붙어 있다', () => {
    for (const id of ['highlights', 'overview', 'included', 'itinerary', 'reviews']) {
      expect(page, `id="${id}" 가 TourDetailPage.tsx 에 없다`).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it('cancellation/faq id 는 각 컴포넌트가 직접 렌더한다 (TourCancellationSection/TourFAQ)', () => {
    const cancellationSection = read('../../src/components/tours/TourCancellationSection.tsx');
    const faqSection = read('../../src/components/tours/TourFAQ.tsx');
    expect(cancellationSection).toMatch(/id="cancellation"/);
    expect(faqSection).toMatch(/id="faq"/);
  });

  it('TourDetailPage 가 TourSectionTabs 와 TourCancellationSection 을 렌더한다', () => {
    expect(page).toContain("import { TourSectionTabs } from '@/components/tours/TourSectionTabs'");
    expect(page).toContain('<TourSectionTabs tabs={sectionTabs}');
    expect(page).toContain("import { TourCancellationSection } from '@/components/tours/TourCancellationSection'");
    expect(page).toContain('<TourCancellationSection language={language} />');
  });

  it('취소정책 섹션은 세부 일정(itinerary) 다음, 미팅포인트/FAQ 앞에 렌더된다', () => {
    const itineraryIdx = page.indexOf('id="itinerary"');
    const cancellationIdx = page.indexOf('<TourCancellationSection');
    const meetingIdx = page.indexOf('<MeetingPointCard');
    const faqIdx = page.indexOf('<TourFAQ');
    expect(itineraryIdx).toBeGreaterThan(-1);
    expect(cancellationIdx).toBeGreaterThan(itineraryIdx);
    expect(cancellationIdx).toBeLessThan(meetingIdx);
    expect(cancellationIdx).toBeLessThan(faqIdx);
  });

  it('sticky 탭은 갤러리+한눈에 보기 stage 다음, 본문 그리드 앞에 렌더된다 (하단 고정 CTA 바는 안 건드림)', () => {
    const stageIdx = page.indexOf('className="tour-detail-stage"');
    const badgeRowIdx = page.indexOf('data-testid="tour-detail-trust-badges"');
    const tabsIdx = page.indexOf('<TourSectionTabs');
    const gridIdx = page.indexOf('className="tour-detail-content-grid"');
    expect(stageIdx).toBeLessThan(badgeRowIdx);
    expect(badgeRowIdx).toBeLessThan(tabsIdx);
    expect(tabsIdx).toBeLessThan(gridIdx);
    // 기존 하단 고정 CTA 바(취소·환불 정책 모달 버튼 포함)는 그대로.
    expect(page).toContain('<RefundPolicyModal');
    expect(page).toMatch(/취소·환불 정책' : language === 'ja' \? 'キャンセル・返金'/);
  });

  it('editorial-tour-detail.css 에 scroll-margin-top 규칙이 있다', () => {
    expect(css).toMatch(/scroll-margin-top\s*:\s*\d+px/);
  });

  it('CSS 는 여전히 그라디언트·backdrop-filter·hex 색상·!important 없이 토큰만 쓴다 (회귀 가드)', () => {
    expect(css).not.toMatch(/(?:linear|radial)-gradient/i);
    expect(css).not.toMatch(/backdrop-filter/i);
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('신뢰 배지 3종 — grounded 문구 4개 언어, 무근거 문구 금지', () => {
  const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

  const FREE_CANCEL: Record<(typeof LANGS)[number], string> = {
    ko: '24시간 전까지 무료 취소',
    en: 'Free cancellation until 24h before',
    ja: '24時間前まで無料キャンセル',
    zh: '24小时前免费取消',
  };
  const INSTANT_CONFIRM: Record<(typeof LANGS)[number], string> = {
    ko: '결제 즉시 예약 확정',
    en: 'Instant confirmation on payment',
    ja: '決済完了と同時に予約確定',
    zh: '支付后立即确认预订',
  };

  for (const lang of LANGS) {
    it(`${lang}: 무료취소·즉시확정 배지 문구가 소스에 있다`, () => {
      expect(page).toContain(FREE_CANCEL[lang]);
      expect(page).toContain(INSTANT_CONFIRM[lang]);
    });
  }

  it('PayPal 배지는 하단 CTA 바와 같은 변수(paypalLabel)를 재사용한다 (문구 이중관리 금지)', () => {
    const badgeRow = page.slice(
      page.indexOf('data-testid="tour-detail-trust-badges"'),
      page.indexOf('</div>', page.indexOf('data-testid="tour-detail-trust-badges"')),
    );
    expect(badgeRow).toContain('{paypalLabel}');
  });

  it('배지 3개가 모두 배지 행 안에서 렌더된다', () => {
    const start = page.indexOf('data-testid="tour-detail-trust-badges"');
    const end = page.indexOf('<TourSectionTabs', start);
    const block = page.slice(start, end);
    expect(block).toContain('{freeCancelBadge}');
    expect(block).toContain('{instantConfirmBadge}');
    expect(block).toContain('{paypalLabel}');
  });

  const BANNED = [/특가/, /인기/, /베스트/, /\bpopular\b/i, /\bbest\b/i, /\bdeal\b/i];

  it('새로 추가한 배지·섹션·탭 문구 어디에도 무근거 마케팅 클레임이 없다 (특가/인기/베스트/popular/best/deal)', () => {
    const cancellationSrc = read('../../src/components/tours/TourCancellationSection.tsx');
    const tabsSrc = read('../../src/components/tours/TourSectionTabs.tsx');
    const surfaces = [
      { name: 'TourDetailPage.tsx (badge row block)', src: page.slice(
        page.indexOf('data-testid="tour-detail-trust-badges"'),
        page.indexOf('<TourSectionTabs', page.indexOf('data-testid="tour-detail-trust-badges"')),
      ) },
      { name: 'TourCancellationSection.tsx', src: cancellationSrc },
      { name: 'TourSectionTabs.tsx', src: tabsSrc },
      { name: 'tourDetailEditorialCopy.ts (new label fields)', src: copy },
    ];
    for (const { name, src } of surfaces) {
      for (const pattern of BANNED) {
        expect(src, `${name} matched banned pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe('탭 라벨 i18n — 기존 필드 재사용 + 신규 필드만 추가', () => {
  it('tourDetailEditorialCopy.ts 가 새 라벨 4개(included/cancellation/faq/reviews)를 4개 언어로 갖는다', () => {
    for (const field of ['includedLabel', 'cancellationLabel', 'faqLabel', 'reviewsLabel']) {
      const matches = copy.match(new RegExp(`${field}:\\s*'[^']+'`, 'g')) || [];
      expect(matches.length, `${field} 가 4개 언어 모두에 없다`).toBe(4);
    }
  });

  it('TourDetailPage 는 highlights/overview/itinerary 탭 라벨에 이미 있는 필드를 재사용한다 (중복 신규 필드 금지)', () => {
    expect(page).toContain("{ id: 'highlights', label: highlightTitle }");
    expect(page).toContain("{ id: 'overview', label: overviewTitle }");
    expect(page).toContain("{ id: 'itinerary', label: itineraryTitle }");
  });
});
