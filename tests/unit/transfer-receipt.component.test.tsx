// @vitest-environment jsdom
/**
 * TransferReceipt 영수증 컴포넌트 렌더 가드 (2026-06-02, 차터 transfer UI).
 * 서울→부산 400km 편도 627,000 / 왕복 1,188,000 + 4-lang + bus null.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TransferReceipt } from '../../src/components/charter/TransferReceipt';

void React;

describe('TransferReceipt — 편도/왕복 영수증 표시', () => {
  it('서울→부산 400km 편도 staria → 총액 627,000', () => {
    const { container } = render(
      <TransferReceipt km={400} tripType="oneway" vehicle="staria" language="ko" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('627,000');
    expect(txt).toContain('600,000');  // base
    expect(txt).toContain('편도');
  });

  it('왕복 staria → 총액 1,188,000', () => {
    const { container } = render(
      <TransferReceipt km={400} tripType="roundtrip" vehicle="staria" language="en" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('1,188,000');
    expect(txt.toLowerCase()).toContain('round-trip');
  });

  it('bus → null (협의)', () => {
    const { container } = render(
      <TransferReceipt km={400} tripType="oneway" vehicle="bus" language="en" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('4개 언어 렌더 (ko/en/ja/zh)', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const { container } = render(
        <TransferReceipt km={200} tripType="oneway" vehicle="staria" language={lang} />,
      );
      expect((container.textContent || '').length).toBeGreaterThan(0);
    }
  });
});
