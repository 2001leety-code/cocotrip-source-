// P312 2차 (2026-06-12): plan.status === 'error' 풀페이지 ErrorState 카피 resolver.
// Header(firebase 의존) 렌더 없이 4-lang + ui-dict override + 폴백 로직만 검증.
import { describe, it, expect } from 'vitest';
import { resolveErrorStateCopy } from '../../src/pages/PlanDetailPage/components/errorStateCopy';

describe('P312 ErrorState — resolveErrorStateCopy', () => {
  it('ko — 인라인 4-lang 폴백 (ui 비어 있어도 정상 문구)', () => {
    const c = resolveErrorStateCopy('ko', {});
    expect(c.title).toBe('일정 생성에 실패했습니다');
    expect(c.retry).toBe('다시 시도');
    expect(c.contact).toBe('1:1 문의');
    expect(c.desc).toContain('결제');
  });

  it('en — 기본 영어 문구', () => {
    const c = resolveErrorStateCopy('en', {});
    expect(c.title).toBe('Itinerary Generation Failed');
    expect(c.retry).toBe('Try Again');
    expect(c.contact).toBe('1:1 Inquiry');
  });

  it('ja / zh — 각 언어 제목', () => {
    expect(resolveErrorStateCopy('ja', {}).title).toBe('旅程の作成に失敗しました');
    expect(resolveErrorStateCopy('zh', {}).title).toBe('行程创建失败');
  });

  it('미지원 언어 → en 폴백', () => {
    const c = resolveErrorStateCopy('fr', {});
    expect(c.title).toBe('Itinerary Generation Failed');
  });

  it('ui dict(planDetail.ui) 키가 있으면 우선 사용 (번역 운영 일원화)', () => {
    const c = resolveErrorStateCopy('en', {
      planErrorTitle: 'Custom Title',
      planErrorDesc: 'Custom Desc',
      planErrorRetry: 'Retry Now',
      planErrorContact: 'Contact Us',
    });
    expect(c.title).toBe('Custom Title');
    expect(c.desc).toBe('Custom Desc');
    expect(c.retry).toBe('Retry Now');
    expect(c.contact).toBe('Contact Us');
  });

  it('ui dict 일부만 있으면 나머지는 인라인 폴백 (부분 누락 graceful)', () => {
    const c = resolveErrorStateCopy('ko', { planErrorTitle: '커스텀 제목' });
    expect(c.title).toBe('커스텀 제목');
    // 나머지는 인라인 ko 폴백 유지
    expect(c.retry).toBe('다시 시도');
    expect(c.contact).toBe('1:1 문의');
  });

  it('빈 문자열 ui 값은 폴백 ( "" 는 || 로 인라인으로 떨어짐 )', () => {
    const c = resolveErrorStateCopy('en', { planErrorTitle: '' });
    expect(c.title).toBe('Itinerary Generation Failed');
  });
});
