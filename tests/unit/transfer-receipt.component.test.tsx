// @vitest-environment jsdom
/**
 * TransferReceipt 영수증 컴포넌트 렌더 가드.
 * 2026-06-05 통일: 4-tier(톨 포함). SEL_METRO→BUSAN(400km, 4-tier) 편도 577,600 / 왕복 1,094,400 + 4-lang + bus null.
 * (curatedKRW = fourTier(400)=608,000 → 편도 ×0.95=577,600 / 왕복 ×2×0.9=1,094,400.)
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TransferReceipt } from '../../src/components/charter/TransferReceipt';

void React;

describe('TransferReceipt — 편도/왕복 영수증 표시', () => {
  it('SEL_METRO→BUSAN 편도 staria → 총액 577,600 (톨 포함 608,000 −5%)', () => {
    const { container } = render(
      <TransferReceipt originKey="SEL_METRO" destKey="BUSAN" tripType="oneway" vehicle="staria" language="ko" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('577,600');
    expect(txt).toContain('608,000');  // 차량 요금 (톨·세금 포함)
    expect(txt).toContain('편도');
  });

  it('왕복 staria → 총액 1,094,400', () => {
    const { container } = render(
      <TransferReceipt originKey="SEL_METRO" destKey="BUSAN" tripType="roundtrip" vehicle="staria" language="en" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('1,094,400');
    expect(txt.toLowerCase()).toContain('round-trip');
  });

  it('bus → null (협의)', () => {
    const { container } = render(
      <TransferReceipt originKey="SEL_METRO" destKey="BUSAN" tripType="oneway" vehicle="bus" language="en" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('매트릭스 미존재 경로 → null', () => {
    const { container } = render(
      <TransferReceipt originKey="ICN" destKey="VOID_CITY" tripType="oneway" vehicle="staria" language="en" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('4개 언어 렌더 (ko/en/ja/zh)', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const { container } = render(
        <TransferReceipt originKey="ICN" destKey="SEL_GANGNAM" tripType="oneway" vehicle="staria" language={lang} />,
      );
      expect((container.textContent || '').length).toBeGreaterThan(0);
    }
  });
});
