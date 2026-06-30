// @vitest-environment jsdom
/**
 * TransferReceipt 영수증 컴포넌트 렌더 가드.
 * 2026-06-05 통일: 4-tier(톨 포함). SEL_METRO→BUSAN(400km, 4-tier) curatedKRW=608,000.
 * 2026-06-30 staria 7인 캡틴 +33,000 정액: 편도 tripBase=641,000 ×0.95=608,950 / 왕복 tripBase=1,249,000 ×0.9=1,124,100.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TransferReceipt } from '../../src/components/charter/TransferReceipt';

void React;

describe('TransferReceipt — 편도/왕복 영수증 표시', () => {
  it('SEL_METRO→BUSAN 편도 staria 7인 → 총액 608,950 (608,000+캡틴33,000=641,000 −5%)', () => {
    const { container } = render(
      <TransferReceipt originKey="SEL_METRO" destKey="BUSAN" tripType="oneway" vehicle="staria" language="ko" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('608,950');
    expect(txt).toContain('641,000');  // 차량 요금 (톨·세금 포함) + 캡틴 33,000
    expect(txt).toContain('편도');
    expect(txt).toContain('$435');  // USD 고정환율 1400 정수 라운드 (608,950/1400=434.96→435) = 실제 청구가
  });

  it('왕복 staria 7인 → 총액 1,124,100 (608,000×2+캡틴33,000=1,249,000 −10%)', () => {
    const { container } = render(
      <TransferReceipt originKey="SEL_METRO" destKey="BUSAN" tripType="roundtrip" vehicle="staria" language="en" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('1,124,100');
    expect(txt.toLowerCase()).toContain('round-trip');
  });

  it('staria_9(9인승) 편도 → 캡틴 0 = 현 staria 원가 (608,000 −5% = 577,600)', () => {
    const { container } = render(
      <TransferReceipt originKey="SEL_METRO" destKey="BUSAN" tripType="oneway" vehicle="staria_9" language="ko" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('577,600'); // 608,000 −5% (캡틴 없음)
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
