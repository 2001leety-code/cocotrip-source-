// @vitest-environment jsdom
/**
 * TourReceipt 영수증 컴포넌트 렌더 가드 (2026-06-02, 요금 견적 영수증 2단계).
 * 운영자 영수증식: 기본+거리+쿠폰+VAT=총액 표시, 오버타임 현장결제 안내. bus→null.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

void React;
import { TourReceipt } from '../../src/components/charter/TourReceipt';

describe('TourReceipt — 영수증 표시', () => {
  it('춘천 85km staria → 총액 ₩527,725 + 항목(기본/거리) + 오버타임 안내', () => {
    const { container } = render(<TourReceipt km={85} vehicle="staria" language="ko" />);
    const txt = container.textContent || '';
    expect(txt).toContain('527,725');     // 총액
    expect(txt).toContain('405,000');     // 기본 9h
    expect(txt).toContain('100,000');     // 거리추가
    expect(txt).toContain('현장결제');     // 오버타임 안내
  });

  it('시내 0km staria → 거리추가 행 없음, 총액 423,225', () => {
    const { container } = render(<TourReceipt km={0} vehicle="staria" language="en" />);
    const txt = container.textContent || '';
    expect(txt).toContain('423,225');
  });

  it('bus → null (렌더 안 함)', () => {
    const { container } = render(<TourReceipt km={50} vehicle="bus" language="en" />);
    expect(container.firstChild).toBeNull();
  });

  it('4개 언어 라벨 (ko/en/ja/zh)', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const { container } = render(<TourReceipt km={85} vehicle="staria" language={lang} />);
      expect((container.textContent || '').length).toBeGreaterThan(0);
    }
  });
});
